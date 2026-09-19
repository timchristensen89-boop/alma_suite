// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useCallback, useEffect, useState } from 'react';
import type { StaffComplianceRecord, StaffProfile } from '@alma/shared';
import { ActionFeedback, ActionPanel, Badge, Button, EmptyState, PageHeader, Select, StatCard } from '@alma/ui';
import { api } from '../lib/api';
import {
  type StaffDocumentPromptAction,
  StaffDocumentActionPrompt,
  STAFF_DOCUMENT_ACCEPT,
  readOnboardingUpload,
  StaffDocumentViewLink,
  staffComplianceDocumentRecord,
  recordDocumentRequested,
  staffRecordStatusTone,
  staffRecordStatusLabel
} from './shared';

type StaffDocumentReviewItem = {
  id: string;
  recordType: string;
  title: string;
  status: string;
  sourceFileName: string;
  sourceFileHash: string;
  candidateName: string | null;
  candidateStaffIds: string[];
  reviewReason: string;
  documentName: string | null;
  documentUrl: string | null;
  notes: string | null;
  createdAt: string;
};

function ApprovalRecordRow({
  member,
  record,
  saving,
  onApprove,
  onReject,
  onUpload,
  onDelete,
  onRequest,
  promptAction,
  onCancelPrompt,
  onConfirmPrompt,
  feedback,
  promptFeedback
}: {
  member: StaffProfile;
  record: StaffComplianceRecord;
  saving: boolean;
  onApprove: (memberId: string, recordId: string) => void;
  onReject: (memberId: string, recordId: string) => void;
  onUpload: (memberId: string, record: StaffComplianceRecord, file: File) => void;
  onDelete: (memberId: string, recordId: string) => void;
  onRequest: (memberId: string, recordId: string) => void;
  promptAction?: StaffDocumentPromptAction | null;
  onCancelPrompt: () => void;
  onConfirmPrompt: () => void;
  feedback?: string | null;
  promptFeedback?: string | null;
}) {
  const documentRecord = staffComplianceDocumentRecord(record);
  return (
    <div className="invite-row">
      <span>
        <strong>{record.title}</strong>
        <span className="subtle">
          {member.firstName} {member.lastName} · {member.venue || 'No venue'} · {record.documentName || 'Uploaded document'}
        </span>
        {record.documentUrl ? (
          <StaffDocumentViewLink documentUrl={record.documentUrl} />
        ) : (
          <span className="subtle">No document attached</span>
        )}
        {documentRecord.dueAt ? <span className="subtle">Due {new Date(documentRecord.dueAt).toLocaleDateString()}</span> : null}
        {recordDocumentRequested(documentRecord) ? <span className="subtle">Document requested</span> : null}
      </span>
      <span className="invite-row-actions">
        <Badge tone={staffRecordStatusTone(documentRecord.status)}>{staffRecordStatusLabel(documentRecord.status)}</Badge>
        <label className="btn btn-secondary btn-sm" style={{ cursor: saving ? 'not-allowed' : 'pointer' }}>
          Upload document
          <input
            type="file"
            accept={STAFF_DOCUMENT_ACCEPT}
            disabled={saving}
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) onUpload(member.id, record, file);
            }}
          />
        </label>
        <Button
          type="button"
          size="sm"
          disabled={saving || documentRecord.status === 'APPROVED' || !record.documentUrl}
          onClick={() => onApprove(member.id, record.id)}
        >
          Approve document
        </Button>
        {record.documentUrl && documentRecord.status !== 'APPROVED' ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={saving}
            onClick={() => onReject(member.id, record.id)}
          >
            Reject
          </Button>
        ) : null}
        <ActionFeedback
          message={feedback}
          tone={feedback?.includes('Could') ? 'error' : 'success'}
        />
        {record.documentUrl ? (
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={saving}
            onClick={() => onDelete(member.id, record.id)}
          >
            Delete document
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={saving}
          onClick={() => onRequest(member.id, record.id)}
        >
          Re-request document
        </Button>
      </span>
      {promptAction ? (
        <StaffDocumentActionPrompt
          action={promptAction}
          saving={saving}
          feedback={promptFeedback}
          onCancel={onCancelPrompt}
          onConfirm={onConfirmPrompt}
        />
      ) : null}
    </div>
  );
}

export function ApprovalsPage({ staff, reload }: { staff: StaffProfile[]; reload: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [documentPrompt, setDocumentPrompt] = useState<{ action: StaffDocumentPromptAction; memberId: string; recordId: string } | null>(null);
  const [reviewItems, setReviewItems] = useState<StaffDocumentReviewItem[]>([]);
  const [reviewStaffSelection, setReviewStaffSelection] = useState<Record<string, string>>({});
  const [reviewError, setReviewError] = useState<string | null>(null);
  const pendingProfiles = staff.filter((member) => member.employmentStatus === 'PENDING');
  const pendingRecords = staff.flatMap((member) =>
    member.records
      .filter((record) => {
        const status = staffComplianceDocumentRecord(record).status;
        return (status === 'PENDING' || status === 'UPLOADED') && Boolean(record.documentUrl);
      })
      .map((record) => ({ member, record }))
  );
  const documentReviewStaff = staff.filter((member) =>
    member.employmentStatus !== 'ARCHIVED' &&
    (member as StaffProfile & { accountType?: string }).accountType !== 'VENUE_DEVICE'
  );
  const staffById = new Map(staff.map((member) => [member.id, member]));

  const loadReviewItems = useCallback(async () => {
    try {
      setReviewError(null);
      setReviewItems(await api<StaffDocumentReviewItem[]>('/api/staff/document-reviews'));
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Could not load manual document reviews.');
    }
  }, []);

  useEffect(() => {
    void loadReviewItems();
  }, [loadReviewItems]);

  useEffect(() => {
    setReviewStaffSelection((current) => {
      const next = { ...current };
      for (const item of reviewItems) {
        if (!next[item.id] && item.candidateStaffIds.length === 1) {
          next[item.id] = item.candidateStaffIds[0]!;
        }
      }
      return next;
    });
  }, [reviewItems]);

  async function approveRecord(memberId: string, recordId: string) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${recordId}`);
    try {
      await api(`/api/staff/${memberId}/records/${recordId}/approve`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      await reload();
      setMessage('Document approved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not approve document.');
    } finally {
      setSaving(false);
    }
  }

  async function rejectRecord(memberId: string, recordId: string) {
    const reason = window.prompt('Reason for rejecting this document?') ?? '';
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${recordId}`);
    try {
      await api(`/api/staff/${memberId}/records/${recordId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      await reload();
      setMessage('Document rejected.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not reject document.');
    } finally {
      setSaving(false);
    }
  }

  async function uploadRecordDocument(memberId: string, record: StaffComplianceRecord, file: File) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${record.id}:upload`);
    try {
      const upload = await readOnboardingUpload(file);
      await api(`/api/staff/${memberId}/records/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          documentName: upload.name,
          documentUrl: upload.url,
          status: 'UPLOADED'
        })
      });
      await reload();
      setMessage('Document uploaded.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not upload document.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDocumentAction() {
    if (!documentPrompt) return;
    const member = staff.find((item) => item.id === documentPrompt.memberId);
    const record = member?.records.find((item) => item.id === documentPrompt.recordId);
    if (!member || !record) {
      setDocumentPrompt(null);
      return;
    }

    if (documentPrompt.action === 'delete' && !record.documentUrl) {
      setDocumentPrompt(null);
      return;
    }

    const actionKey = documentPrompt.action === 'delete' ? 'remove' : 'request';
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${record.id}:${actionKey}`);
    try {
      await api(`/api/staff/${member.id}/records/${record.id}/${documentPrompt.action === 'delete' ? 'document' : 'request-document'}`, {
        method: documentPrompt.action === 'delete' ? 'DELETE' : 'POST'
      });
      await reload();
      setDocumentPrompt(null);
      setMessage(documentPrompt.action === 'delete'
        ? 'Document deleted. The record is still available for follow-up.'
        : 'Document requested again. Marked for follow-up; ask the staff member to upload again.');
    } catch (err) {
      setMessage(err instanceof Error
        ? err.message
        : documentPrompt.action === 'delete' ? 'Could not delete document.' : 'Could not request document.');
    } finally {
      setSaving(false);
    }
  }

  /**
   * Approve a new starter.
   *
   * The API refuses when payroll details are missing and names them, because
   * activating somebody with no tax file number or bank account is how 13 of
   * the 30 active staff ended up needing chasing by hand. A manager who really
   * does need them on Saturday's roster can still say so — they're asked for a
   * reason, which is written onto the profile where payroll will see it.
   */
  // Push (or re-push) someone into Xero Payroll by hand. Needed when the
  // automatic push on approval failed for a missing field, and whenever their
  // bank, tax or super details change afterwards.
  async function pushToXero(memberId: string) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`profile:${memberId}`);
    try {
      const result = await api<{
        organisations: Array<{ tenantName: string | null; action: string }>;
        warnings?: string[];
      }>(`/api/staff/${memberId}/push-to-xero`, { method: 'POST' });
      const where = result.organisations
        .map((org) => `${org.tenantName ?? 'Xero'} (${org.action})`)
        .join(', ');
      const warn = result.warnings?.length ? ` — ${result.warnings.join(' ')}` : '';
      setMessage(`Sent to ${where}.${warn}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not push to Xero.');
    } finally {
      setSaving(false);
    }
  }

  async function approveProfile(memberId: string, options: { force?: boolean; reason?: string } = {}) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`profile:${memberId}`);
    try {
      const approved = await api<StaffProfile & { xeroPush?: { ok: boolean; message: string } | null }>(
        `/api/staff/${memberId}/onboarding/approve`,
        { method: 'POST', body: JSON.stringify(options) }
      );
      await reload();
      // Approval also pushes them into Xero Payroll. It never blocks the
      // approval, so say plainly whether payroll got them — a manager who
      // isn't told will assume it worked.
      const xero = approved.xeroPush
        ? approved.xeroPush.ok
          ? ` Xero: ${approved.xeroPush.message}`
          : ` Xero did NOT get them — ${approved.xeroPush.message}`
        : '';
      setMessage(
        (options.force
          ? 'Activated with onboarding gaps. Noted on their profile for payroll.'
          : 'Onboarding approved and profile activated.') + xero
      );
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not approve onboarding.';
      if (!options.force && text.includes("hasn't finished onboarding")) {
        const reason = window.prompt(
          `${text}\n\nTo activate them anyway, say why (this is saved on their profile):`
        );
        if (reason === null) {
          setMessage(text);
          setSaving(false);
          return;
        }
        setSaving(false);
        await approveProfile(memberId, { force: true, reason: reason.trim() || 'No reason given' });
        return;
      }
      setMessage(text);
    } finally {
      setSaving(false);
    }
  }

  async function approveReviewItem(reviewId: string) {
    const staffProfileId = reviewStaffSelection[reviewId];
    if (!staffProfileId) {
      setMessageTarget(`review:${reviewId}`);
      setMessage('Choose a staff member before approving this RSA document.');
      return;
    }
    setSaving(true);
    setMessage(null);
    setMessageTarget(`review:${reviewId}`);
    try {
      await api(`/api/staff/document-reviews/${reviewId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ staffProfileId })
      });
      await Promise.all([reload(), loadReviewItems()]);
      setMessage('Review approved. RSA document is now attached to the selected staff profile for document approval.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not approve document review.');
    } finally {
      setSaving(false);
    }
  }

  async function rejectReviewItem(reviewId: string) {
    if (!window.confirm('Reject this imported RSA document review item?')) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`review:${reviewId}`);
    try {
      await api(`/api/staff/document-reviews/${reviewId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Rejected from Staff approvals.' })
      });
      await loadReviewItems();
      setMessage('Review item rejected.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not reject document review.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Staff approvals"
        title="Approve onboarding details and uploaded documents"
        description="New staff submit payroll, tax, bank, super, visa and document details here before their profile is activated."
      />

      <div className="stats-grid">
        <StatCard label="Pending profiles" value={pendingProfiles.length} hint="Awaiting manager approval" />
        <StatCard label="Pending documents" value={pendingRecords.length} hint="Uploaded or waiting" />
        <StatCard label="Manual RSA reviews" value={reviewItems.length} hint="Imported files to map" />
      </div>

      {message && !messageTarget ? <p className={message.includes('Could not') || message.includes('Missing') ? 'error-text' : 'subtle'}>{message}</p> : null}

      <ActionPanel
        title="Pending onboarding profiles"
        description="Approve once details and required uploads have been checked."
        count={pendingProfiles.length}
        tone={pendingProfiles.length ? 'warning' : 'positive'}
        defaultOpen={pendingProfiles.length === 1}
        empty={<EmptyState title="No staff waiting for approval" description="Completed onboarding submissions will appear here." />}
      >
        {pendingProfiles.length === 0 ? (
          <EmptyState title="No staff waiting for approval" description="Completed onboarding submissions will appear here." />
        ) : (
          <div className="invite-list">
            {pendingProfiles.map((member) => {
              const pending = member.records.filter((record) => record.status === 'PENDING').length;
              const uploaded = member.records.filter((record) => Boolean(record.documentUrl)).length;
              const readyToApprove = pending === 0;
              return (
                <div key={member.id} className="invite-row">
                  <span>
                    <strong>{member.firstName} {member.lastName}</strong>
                    <span className="subtle">
                      {member.roleTitle} · {member.venue || 'No venue'} · {member.email || 'No email'}
                    </span>
                    <span className="subtle">{uploaded} uploaded documents · {pending} documents pending approval</span>
                  </span>
                  <span className="invite-row-actions">
                    <Badge tone="warning">Pending onboarding</Badge>
                    <Button type="button" size="sm" disabled={saving || !readyToApprove} onClick={() => void approveProfile(member.id)}>
                      {readyToApprove ? 'Approve onboarding' : 'Approve documents first'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={saving}
                      title="Send their details to Xero Payroll — both companies if they work at both"
                      onClick={() => void pushToXero(member.id)}
                    >
                      Push to Xero
                    </Button>
                    <ActionFeedback
                      message={messageTarget === `profile:${member.id}` ? message : null}
                      tone={message?.includes('Could') ? 'error' : 'success'}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </ActionPanel>

      <ActionPanel
        title="Manual RSA review queue"
        description="Uncertain Deputy RSA files sit here until a manager selects the right staff member. They are not attached to staff profiles until approved."
        count={reviewItems.length}
        tone={reviewItems.length ? 'warning' : 'positive'}
        defaultOpen={reviewItems.length === 1}
        empty={<EmptyState title="No RSA documents waiting for manual review" description="Run the Deputy document importer with --review-uncertain-rsa to populate this queue." />}
      >
        {reviewError ? <p className="error-text">{reviewError}</p> : null}
        {reviewItems.length === 0 ? (
          <EmptyState title="No RSA documents waiting for manual review" description="Run the Deputy document importer with --review-uncertain-rsa to populate this queue." />
        ) : (
          <div className="invite-list">
            {reviewItems.map((item) => {
              const candidateStaff = item.candidateStaffIds
                .map((id) => staffById.get(id))
                .filter((member): member is StaffProfile => Boolean(member));
              const selectedStaffId = reviewStaffSelection[item.id] ?? '';
              return (
                <div key={item.id} className="invite-row">
                  <span>
                    <strong>{item.title}</strong>
                    <span className="subtle">
                      {item.sourceFileName} · {item.reviewReason.replaceAll('_', ' ')}
                    </span>
                    {item.candidateName ? <span className="subtle">Candidate name: {item.candidateName}</span> : null}
                    {candidateStaff.length ? (
                      <span className="subtle">
                        Candidate staff: {candidateStaff.map((member) => `${member.firstName} ${member.lastName}`).join(', ')}
                      </span>
                    ) : (
                      <span className="subtle">No confident candidate staff match.</span>
                    )}
                    <StaffDocumentViewLink documentUrl={item.documentUrl} />
                    {item.notes ? <span className="subtle">{item.notes}</span> : null}
                  </span>
                  <span className="invite-row-actions staff-review-actions">
                    <Badge tone="warning">Manual review</Badge>
                    <Select
                      label="Attach to staff"
                      value={selectedStaffId}
                      onChange={(event) => { const el = event.currentTarget; setReviewStaffSelection((current) => ({ ...current, [item.id]: el.value })); }}
                      options={[
                        { label: 'Choose staff', value: '' },
                        ...documentReviewStaff.map((member) => ({
                          label: `${member.firstName} ${member.lastName}${member.venue ? ` · ${member.venue}` : ''}`,
                          value: member.id
                        }))
                      ]}
                    />
                    <Button type="button" size="sm" disabled={saving || !selectedStaffId} onClick={() => void approveReviewItem(item.id)}>
                      Approve and attach
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void rejectReviewItem(item.id)}>
                      Reject
                    </Button>
                    <ActionFeedback
                      message={messageTarget === `review:${item.id}` ? message : null}
                      tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </ActionPanel>

      <ActionPanel
        title="Document approval queue"
        description="Open each uploaded document, upload missing files if needed, then approve."
        count={pendingRecords.length}
        tone={pendingRecords.length ? 'warning' : 'positive'}
        defaultOpen={pendingRecords.length === 1}
        empty={<EmptyState title="No documents waiting" description="Pending uploaded documents will appear here." />}
      >
        {pendingRecords.length === 0 ? (
          <EmptyState title="No documents waiting" description="Pending uploaded documents will appear here." />
        ) : (
          <div className="invite-list">
            {pendingRecords.map(({ member, record }) => (
              <ApprovalRecordRow
                key={record.id}
                member={member}
                record={record}
                saving={saving}
                onApprove={(memberId, recordId) => void approveRecord(memberId, recordId)}
                onReject={(memberId, recordId) => void rejectRecord(memberId, recordId)}
                onUpload={(memberId, approvalRecord, file) => void uploadRecordDocument(memberId, approvalRecord, file)}
                onDelete={(memberId, recordId) => setDocumentPrompt({ action: 'delete', memberId, recordId })}
                onRequest={(memberId, recordId) => setDocumentPrompt({ action: 'request', memberId, recordId })}
                promptAction={documentPrompt?.memberId === member.id && documentPrompt.recordId === record.id ? documentPrompt.action : null}
                onCancelPrompt={() => setDocumentPrompt(null)}
                onConfirmPrompt={() => void confirmDocumentAction()}
                feedback={
                  messageTarget === `record:${record.id}` ||
                  messageTarget === `record:${record.id}:upload` ||
                  messageTarget === `record:${record.id}:remove` ||
                  messageTarget === `record:${record.id}:request`
                    ? message
                    : null
                }
                promptFeedback={
                  messageTarget === `record:${record.id}:remove` || messageTarget === `record:${record.id}:request`
                    ? message
                    : null
                }
              />
            ))}
          </div>
        )}
      </ActionPanel>
    </div>
  );
}
