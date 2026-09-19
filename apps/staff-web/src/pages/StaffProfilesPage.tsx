// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { StaffProfile, StaffRoleTemplate } from '@alma/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '@alma/ui';
import { api } from '../lib/api';
import { isExpiringSoon } from '../lib/datetime';
import {
  type StaffFormState,
  normaliseEmploymentStatus,
  isTerminatedStaffProfile,
  StaffModal,
  StaffProfileForm,
  type CreatedStaffInvite,
  isDeputyImportedProfile,
  isUnallocatedProfile
} from './shared';

type StaffProfileStatusFilter = 'current' | 'active' | 'pending' | 'terminated' | 'all';

const STAFF_PROFILE_STATUS_FILTERS: Array<{ id: StaffProfileStatusFilter; label: string }> = [
  { id: 'current', label: 'Current' },
  { id: 'active', label: 'Active' },
  { id: 'pending', label: 'Pending' },
  { id: 'terminated', label: 'Terminated' },
  { id: 'all', label: 'All' }
];

function staffProfileStatusRank(member: Pick<StaffProfile, 'employmentStatus'>) {
  const status = normaliseEmploymentStatus(member);
  if (status === 'ACTIVE') return 0;
  if (status === 'PENDING') return 1;
  return 2;
}

function staffProfileSortLabel(member: Pick<StaffProfile, 'firstName' | 'lastName' | 'venue'>) {
  return `${member.venue ?? ''} ${member.firstName} ${member.lastName}`.trim().toLowerCase();
}

export function StaffProfilesPage({
  staff,
  roleTemplates,
  loading,
  onSelect,
  reload
}: {
  staff: StaffProfile[];
  roleTemplates: StaffRoleTemplate[];
  loading: boolean;
  onSelect: (id: string) => void;
  reload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [form, setForm] = useState<StaffFormState>({ mode: 'closed' });
  const [reonboardingId, setReonboardingId] = useState<string | null>(null);
  const [reonboardMessage, setReonboardMessage] = useState<string | null>(null);
  const [reonboardError, setReonboardError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StaffProfileStatusFilter>('current');
  // Merge-duplicate flow: the profile being merged AWAY, the profile that
  // keeps everything, and the round-trip state. The source can be a normal
  // register profile OR a hidden (archived) duplicate that no longer shows in
  // the register but still owns timesheets and tip lines.
  const [mergeSource, setMergeSource] = useState<{ id: string; firstName: string; lastName: string } | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [hiddenDuplicates, setHiddenDuplicates] = useState<Array<{
    id: string;
    firstName: string;
    lastName: string;
    roleTitle: string | null;
    venue: string | null;
    hasBankDetails: boolean;
    counts: { timesheets: number; tipPaymentRunLines: number; rosterShifts: number; clockSessions: number };
  }>>([]);

  const loadHiddenDuplicates = useCallback(async () => {
    try {
      setHiddenDuplicates(await api<typeof hiddenDuplicates>('/api/staff/archived-duplicates'));
    } catch {
      // Non-manager or older API — the section just stays hidden.
    }
  }, []);

  useEffect(() => {
    void loadHiddenDuplicates();
  }, [loadHiddenDuplicates]);

  async function runMerge() {
    if (!mergeSource || !mergeTargetId) return;
    setMergeBusy(true);
    setMergeError(null);
    try {
      const result = await api<{
        canonicalStaffProfile: StaffProfile;
        moved: Record<string, number>;
      }>('/api/staff/merge', {
        method: 'POST',
        body: JSON.stringify({
          canonicalStaffProfileId: mergeTargetId,
          duplicateStaffProfileIds: [mergeSource.id],
          confirmation: 'MERGE STAFF'
        })
      });
      const movedSummary = Object.entries(result.moved ?? {})
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${count} ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}`)
        .join(', ');
      setReonboardMessage(
        `Merged ${mergeSource.firstName} ${mergeSource.lastName} into ${result.canonicalStaffProfile.firstName} ${result.canonicalStaffProfile.lastName}.${movedSummary ? ` Moved: ${movedSummary}.` : ''}`
      );
      setMergeSource(null);
      setMergeTargetId('');
      await Promise.all([reload(), loadHiddenDuplicates()]);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Merge failed.');
    } finally {
      setMergeBusy(false);
    }
  }

  const statusCounts = useMemo(() => {
    const active = staff.filter((member) => normaliseEmploymentStatus(member) === 'ACTIVE').length;
    const pending = staff.filter((member) => normaliseEmploymentStatus(member) === 'PENDING').length;
    const terminated = staff.filter(isTerminatedStaffProfile).length;
    return {
      active,
      pending,
      terminated,
      current: active + pending,
      all: staff.length
    };
  }, [staff]);

  const visibleStaff = useMemo(() => {
    return staff
      .filter((member) => {
        const status = normaliseEmploymentStatus(member);
        if (statusFilter === 'active') return status === 'ACTIVE';
        if (statusFilter === 'pending') return status === 'PENDING';
        if (statusFilter === 'terminated') return isTerminatedStaffProfile(member);
        if (statusFilter === 'current') return !isTerminatedStaffProfile(member);
        return true;
      })
      .slice()
      .sort((a, b) => {
        const statusDelta = statusFilter === 'terminated' ? 0 : staffProfileStatusRank(a) - staffProfileStatusRank(b);
        if (statusDelta !== 0) return statusDelta;
        return staffProfileSortLabel(a).localeCompare(staffProfileSortLabel(b));
      });
  }, [staff, statusFilter]);

  function openProfile(id: string, section = 'personal') {
    onSelect(id);
    navigate(`/staff/${id}/${section}`);
  }

  async function handleSaved(member: StaffProfile) {
    await reload();
    openProfile(member.id);
    setForm({ mode: 'closed' });
  }

  async function reonboardLightweightProfile(member: StaffProfile) {
    setReonboardMessage(null);
    setReonboardError(null);
    if (!member.email) {
      setReonboardError(`Add an email to ${member.firstName} ${member.lastName} before sending an onboarding link.`);
      setForm({ mode: 'edit', member });
      return;
    }

    setReonboardingId(member.id);
    try {
      const created = await api<CreatedStaffInvite>(`/api/staff/profiles/${member.id}/reonboard`, {
        method: 'POST',
        body: JSON.stringify({
          onboardingBaseUrl: window.location.origin,
          expiresInDays: 30,
          note: 'Please complete your ALMA Staff onboarding details.'
        })
      });
      setReonboardMessage(
        created.emailDelivery?.status === 'sent'
          ? `Re-onboarding link sent to ${created.email ?? member.email}.`
          : `Re-onboarding link is ready to copy. ${created.emailDelivery?.reason ?? 'Email was not sent.'}`
      );
      await reload();
    } catch (err) {
      setReonboardError(err instanceof Error ? err.message : 'Could not send re-onboarding link.');
    } finally {
      setReonboardingId(null);
    }
  }

  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  async function reactivateProfile(member: StaffProfile) {
    setReactivatingId(member.id);
    setReonboardError(null);
    try {
      await api(`/api/staff/${member.id}`, { method: 'PATCH', body: JSON.stringify({ employmentStatus: 'ACTIVE' }) });
      setReonboardMessage(`${member.firstName} ${member.lastName} is active again — records, PIN and history intact.`);
      await reload();
    } catch (err) {
      setReonboardError(err instanceof Error ? err.message : 'Could not reactivate.');
    } finally {
      setReactivatingId(null);
    }
  }

  const renderStaffRow = (member: StaffProfile) => {
    const soon = member.records.filter((record) => record.expiryDate && isExpiringSoon(record.expiryDate)).length;
    const uploadedDocuments = member.records.filter((record) => Boolean(record.documentUrl)).length;
    const uploadedRsa = member.records.some((record) => record.recordType === 'RSA' && record.documentUrl);
    return (
      <div key={member.id} className="staff-list-button">
        <button type="button" className="staff-list-main" onClick={() => openProfile(member.id)}>
          <span>
            <strong>
              {member.firstName} {member.lastName}
            </strong>
            <span className="subtle" style={{ display: 'block' }}>
              {member.roleTitle} · {member.venue || 'No venue'} · {member.email || 'No email'}
            </span>
            {uploadedDocuments ? <span className="subtle" style={{ display: 'block' }}>{uploadedDocuments} uploaded document{uploadedDocuments === 1 ? '' : 's'} in profile</span> : null}
            {soon ? <span className="subtle" style={{ display: 'block' }}>{soon} record{soon === 1 ? '' : 's'} expiring soon</span> : null}
          </span>
        </button>
        <span className="staff-row-actions">
          {uploadedRsa ? <Badge tone="positive">RSA uploaded</Badge> : null}
          {isDeputyImportedProfile(member) ? <Badge tone="info">Roster import</Badge> : null}
          {isUnallocatedProfile(member) ? <Badge tone="warning">Unallocated</Badge> : null}
          <Badge tone={member.employmentStatus === 'ACTIVE' ? 'positive' : 'warning'}>{member.employmentStatus}</Badge>
          {isTerminatedStaffProfile(member) ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={reactivatingId === member.id}
              onClick={(event) => {
                event.stopPropagation();
                void reactivateProfile(member);
              }}
            >
              {reactivatingId === member.id ? 'Reactivating…' : 'Reactivate'}
            </Button>
          ) : null}
          {isDeputyImportedProfile(member) ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={reonboardingId === member.id}
              onClick={(event) => {
                event.stopPropagation();
                void reonboardLightweightProfile(member);
              }}
            >
              {reonboardingId === member.id ? 'Sending...' : 'Re-onboard'}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              openProfile(member.id, 'documents');
            }}
          >
            Documents
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              openProfile(member.id, 'personal');
            }}
          >
            Profile
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              openProfile(member.id, 'payroll');
            }}
          >
            Payroll
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              setMergeTargetId('');
              setMergeError(null);
              setMergeSource(member);
            }}
          >
            Merge
          </Button>
        </span>
      </div>
    );
  };

  const currentRows = visibleStaff.filter((member) => !isTerminatedStaffProfile(member));
  const terminatedRows = visibleStaff.filter(isTerminatedStaffProfile);

  return (
    <div className="page-stack staff-settings-page">
      <PageHeader
        eyebrow="Profiles"
        title="Staff profiles"
        description="Shared StaffProfile records for Staff, Compliance, Stock and Training."
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => navigate('/')}>Back to staff home</Button>
            <Button type="button" onClick={() => setForm({ mode: 'create' })}>New staff</Button>
          </>
        }
      />

      {reonboardMessage ? <p className="subtle">{reonboardMessage}</p> : null}
      {reonboardError ? <p className="error-text">{reonboardError}</p> : null}

      <Card
        title="Staff register"
        subtitle="Open a profile for documents, role permissions, employment details, and HR sections."
        padding="none"
        action={
          <Button type="button" size="sm" onClick={() => setForm({ mode: 'create' })}>
            New staff
          </Button>
        }
      >
        {loading ? <Spinner label="Loading staff..." /> : null}
        {!loading && staff.length === 0 ? (
          <EmptyState
            title="No staff profiles yet"
            description="Create staff here, then manage roster and app access."
            action={<Button type="button" onClick={() => setForm({ mode: 'create' })}>Create first staff profile</Button>}
          />
        ) : null}
        {!loading && staff.length > 0 ? (
          <div className="staff-status-toolbar" aria-label="Staff status filters">
            <div className="staff-status-filter-group" role="group" aria-label="Filter staff profiles by status">
              {STAFF_PROFILE_STATUS_FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`staff-status-filter ${statusFilter === item.id ? 'is-active' : ''}`}
                  onClick={() => setStatusFilter(item.id)}
                  aria-pressed={statusFilter === item.id}
                >
                  <span>{item.label}</span>
                  <strong>{statusCounts[item.id]}</strong>
                </button>
              ))}
            </div>
            <span className="staff-status-toolbar__summary">
              Showing {visibleStaff.length} of {staff.length} profiles
            </span>
          </div>
        ) : null}
        <div className="staff-list" style={{ padding: 12 }}>
          {!loading && staff.length > 0 && visibleStaff.length === 0 ? (
            <EmptyState
              title="No staff match this status"
              description="Choose another status filter to see more profiles."
            />
          ) : null}
          {currentRows.length > 0 ? (
            <>
              {terminatedRows.length > 0 ? <div className="staff-list-section-head">Current staff</div> : null}
              {currentRows.map(renderStaffRow)}
            </>
          ) : null}
          {terminatedRows.length > 0 ? (
            <>
              <div className="staff-list-section-head">Terminated staff</div>
              {terminatedRows.map(renderStaffRow)}
            </>
          ) : null}
        </div>
      </Card>

      {hiddenDuplicates.length ? (
        <Card
          title="Hidden duplicate profiles"
          subtitle="Archived identities that still own timesheets, tips or shifts. They keep surfacing in pay runs (and block ABA exports when they have no bank details) until they're merged into the real profile."
          padding="none"
        >
          <div className="staff-list" style={{ padding: 12 }}>
            {hiddenDuplicates.map((duplicate) => (
              <div key={duplicate.id} className="staff-list-button">
                <span className="staff-list-main" style={{ cursor: 'default' }}>
                  <span>
                    <strong>{duplicate.firstName} {duplicate.lastName}</strong>
                    <span className="subtle" style={{ display: 'block' }}>
                      {[duplicate.roleTitle, duplicate.venue || 'No venue'].filter(Boolean).join(' · ')}
                      {' · '}
                      {duplicate.counts.timesheets} timesheet{duplicate.counts.timesheets === 1 ? '' : 's'}
                      {' · '}
                      {duplicate.counts.tipPaymentRunLines} tip line{duplicate.counts.tipPaymentRunLines === 1 ? '' : 's'}
                      {' · '}
                      {duplicate.counts.rosterShifts} shift{duplicate.counts.rosterShifts === 1 ? '' : 's'}
                    </span>
                  </span>
                </span>
                <span className="staff-row-actions">
                  {!duplicate.hasBankDetails ? <Badge tone="warning">No bank details</Badge> : null}
                  <Badge tone="muted">Archived</Badge>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setMergeTargetId('');
                      setMergeError(null);
                      setMergeSource(duplicate);
                    }}
                  >
                    Merge into…
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <StaffModal
        open={form.mode !== 'closed'}
        title={form.mode === 'edit' ? `Edit ${form.member.firstName} ${form.member.lastName}` : 'New staff profile'}
        subtitle="Create or update the shared staff authority without losing your place in the register."
        onClose={() => setForm({ mode: 'closed' })}
      >
        {form.mode !== 'closed' ? (
          <StaffProfileForm
            mode={form.mode}
            initial={form.mode === 'edit' ? form.member : undefined}
            roleTemplates={roleTemplates}
            onSaved={(member) => void handleSaved(member)}
            onCancel={() => setForm({ mode: 'closed' })}
          />
        ) : null}
      </StaffModal>

      <StaffModal
        open={mergeSource !== null}
        title={mergeSource ? `Merge ${mergeSource.firstName} ${mergeSource.lastName} into another profile` : 'Merge profiles'}
        subtitle="For duplicate identities — everything moves to the profile you keep."
        onClose={() => {
          if (!mergeBusy) {
            setMergeSource(null);
            setMergeTargetId('');
            setMergeError(null);
          }
        }}
        width="standard"
      >
        {mergeSource ? (
          <div className="page-stack" style={{ gap: 12 }}>
            <p className="subtle">
              Every timesheet, tip payment, roster shift, clock record, leave request, HR and compliance record on{' '}
              <strong>{mergeSource.firstName} {mergeSource.lastName}</strong> moves to the profile you keep. Missing details
              on the kept profile (bank account, TFN, super, contact info) are filled in from the duplicate, then the
              duplicate is archived. Future roster imports that use the old name resolve to the kept profile automatically.
              This cannot be undone.
            </p>
            <label className="field">
              <span>Profile to keep</span>
              <select
                aria-label="Profile to keep"
                value={mergeTargetId}
                onChange={(event) => setMergeTargetId(event.currentTarget.value)}
              >
                <option value="">Choose the profile to keep…</option>
                {staff
                  .filter((member) => member.id !== mergeSource.id)
                  .slice()
                  .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.firstName} {member.lastName}{member.venue ? ` · ${member.venue}` : ''}{member.roleTitle ? ` · ${member.roleTitle}` : ''}
                    </option>
                  ))}
              </select>
            </label>
            {mergeError ? <p className="error-text">{mergeError}</p> : null}
            <div className="toolbar-right">
              <Button
                type="button"
                variant="ghost"
                disabled={mergeBusy}
                onClick={() => {
                  setMergeSource(null);
                  setMergeTargetId('');
                  setMergeError(null);
                }}
              >
                Cancel
              </Button>
              <Button type="button" disabled={mergeBusy || !mergeTargetId} onClick={() => void runMerge()}>
                {mergeBusy ? 'Merging…' : 'Merge profiles'}
              </Button>
            </div>
          </div>
        ) : null}
      </StaffModal>
    </div>
  );
}
