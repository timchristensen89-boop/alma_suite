import { useState } from 'react';
import {
  AWARD_RATE_SETS,
  DEFAULT_STAFF_AWARD_CLASSIFICATION,
  DEFAULT_STAFF_AWARD_CODE,
  type AlmaAppId,
  type AustralianAwardCode,
  type ManualFullTimePayFrequency,
  type StaffAppAccess,
  type StaffAwardEmploymentType,
  type StaffPayProfile,
  type StaffPayProfileInput
} from '@alma/shared';
import type {
  StaffComplianceRecord,
  StaffManagementEvent,
  StaffManagerNote,
  StaffProfile,
  StaffRecordType,
  StaffSummary
} from '@alma/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatCard,
  Textarea
} from '@alma/ui';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import {
  IconCamera,
  IconClock,
  IconPlus,
  IconRefresh,
  IconStaff
} from '../lib/icons';
import { PhotoField } from '../features/staff/PhotoField';
import {
  recordTypeOptions
} from '../features/staff/StaffProfileForm';
import { useAuth } from '../lib/auth';

export function StaffPage() {
  const auth = useAuth();
  const staff = useAsync<StaffProfile[]>(() => api('/api/staff'), []);
  const summary = useAsync<StaffSummary>(() => api('/api/staff/meta'), []);

  const [message, setMessage] = useState('');
  const [addingRecordFor, setAddingRecordFor] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [accessFor, setAccessFor] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const visibleStaff = staff.data ?? [];
  const selectedStaff = visibleStaff.filter((member) => selectedStaffIds.includes(member.id));
  const canManageStaff = Boolean(
    auth.user?.isAdmin ||
      auth.user?.role === 'ADMIN' ||
      auth.user?.role === 'MANAGER'
  );
  const canViewManagementHistory = Boolean(auth.user?.isAdmin || auth.user?.role === 'ADMIN');
  const roleOptions = Array.from(
    new Set(
      [
        'Team member',
        'Food and beverage attendant',
        'Supervisor',
        'Manager',
        'Chef',
        'Cook',
        'Kitchen hand',
        ...visibleStaff.map((member) => member.roleTitle).filter(Boolean)
      ].sort((a, b) => a.localeCompare(b))
    )
  ).map((role) => ({ label: role, value: role }));

  async function reloadStaff() {
    await Promise.all([staff.reload(), summary.reload()]);
  }

  function toggleSelected(staffId: string) {
    setSelectedStaffIds((current) =>
      current.includes(staffId)
        ? current.filter((id) => id !== staffId)
        : [...current, staffId]
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Staff compliance"
        title="Staff document register"
        description="View staff from the Staff app and maintain RSA, FSS, First Aid, training, and certificate records for compliance."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<IconRefresh size={14} />}
              onClick={() => {
                void reloadStaff();
              }}
            >
              Refresh
            </Button>
          </>
        }
      />

      <div className="stats-grid">
        <StatCard
          label="Profiles"
          value={summary.data?.totalProfiles ?? 0}
          hint="Active register"
          icon={<IconStaff size={16} />}
          loading={summary.loading}
        />
        <StatCard
          label="Expiring soon"
          value={summary.data?.expiringSoon ?? 0}
          hint="Next 30 days"
          icon={<IconClock size={16} />}
          tone={(summary.data?.expiringSoon ?? 0) > 0 ? 'warning' : 'neutral'}
          loading={summary.loading}
        />
        <StatCard
          label="Expired"
          value={summary.data?.expired ?? 0}
          hint="Action required"
          icon={<IconClock size={16} />}
          tone={(summary.data?.expired ?? 0) > 0 ? 'danger' : 'positive'}
          loading={summary.loading}
        />
        <StatCard
          label="Pending approval"
          value={summary.data?.pendingApproval ?? 0}
          hint="Awaiting verification"
          icon={<IconStaff size={16} />}
          loading={summary.loading}
        />
      </div>

      {message ? (
        <Card>
          <p className={message.toLowerCase().includes('failed') || message.toLowerCase().includes('cannot') || message.toLowerCase().includes('already') ? 'error-text' : 'subtle'}>{message}</p>
        </Card>
      ) : null}

      <Card padding="none">
          <div className="table-toolbar">
            <span>
              {staff.loading ? (
                <Spinner label="Loading staff…" />
              ) : (
                <>
                  <strong style={{ color: 'var(--color-text)' }}>
                    {visibleStaff.length}
                  </strong>{' '}
                  {visibleStaff.length === 1 ? 'staff member' : 'staff members'}
                </>
              )}
            </span>
            {canManageStaff ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {selectedStaffIds.length > 0 ? (
                  <span className="subtle">{selectedStaffIds.length} selected</span>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={selectedStaffIds.length < 2}
                  onClick={() => setMergeOpen((current) => !current)}
                >
                  Merge duplicates
                </Button>
              </div>
            ) : null}
          </div>

          {mergeOpen && canManageStaff ? (
            <MergeDuplicatesPanel
              selectedStaff={selectedStaff}
              onCancel={() => setMergeOpen(false)}
              onDone={async (summaryMessage) => {
                setMessage(summaryMessage);
                setMergeOpen(false);
                setSelectedStaffIds([]);
                await reloadStaff();
              }}
            />
          ) : null}

          {!staff.loading && visibleStaff.length === 0 ? (
            <EmptyState
              icon={<IconStaff size={22} />}
              title="No staff yet"
              description="Onboard staff in the Staff app. Their compliance documents will appear here."
            />
          ) : null}

          <div style={{ padding: 4 }}>
            {visibleStaff.map((member) => (
              <article
                key={member.id}
                style={{
                  padding: 14,
                  borderBottom: '1px solid var(--color-border)'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 14,
                    alignItems: 'flex-start'
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
                    {canManageStaff ? (
                      <input
                        type="checkbox"
                        aria-label={`Select ${member.firstName} ${member.lastName} for duplicate merge`}
                        checked={selectedStaffIds.includes(member.id)}
                        onChange={() => toggleSelected(member.id)}
                        style={{ marginTop: 2 }}
                      />
                    ) : null}
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <strong style={{ fontSize: 14 }}>
                        {member.firstName} {member.lastName}
                      </strong>
                      <span className="subtle">
                        {member.roleTitle} · {member.venue || 'Unassigned venue'}
                        {member.email ? ` · ${member.email}` : ''}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Badge tone="muted">{member.records.length} records</Badge>
                    {canManageStaff ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-expanded={accessFor === member.id}
                          aria-controls={`role-access-${member.id}`}
                          onClick={() => setAccessFor(accessFor === member.id ? null : member.id)}
                        >
                          Role/access
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-expanded={payFor === member.id}
                          aria-controls={`award-pay-${member.id}`}
                          onClick={() => setPayFor(payFor === member.id ? null : member.id)}
                        >
                          Award pay
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-expanded={notesFor === member.id}
                          aria-controls={`manager-notes-${member.id}`}
                          aria-label={`Manager notes for ${member.firstName} ${member.lastName}`}
                          onClick={() =>
                            setNotesFor(notesFor === member.id ? null : member.id)
                          }
                        >
                          Manager notes
                        </Button>
                        {canViewManagementHistory ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-expanded={historyFor === member.id}
                            aria-controls={`management-history-${member.id}`}
                            onClick={() => setHistoryFor(historyFor === member.id ? null : member.id)}
                          >
                            Audit trail
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          leftIcon={<IconPlus size={14} />}
                          onClick={() =>
                            setAddingRecordFor(
                              addingRecordFor === member.id ? null : member.id
                            )
                          }
                        >
                          Add record
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 10,
                    marginTop: 10
                  }}
                >
                  {member.records.length === 0 ? (
                    <span className="subtle">No compliance records on file yet.</span>
                  ) : (
                    member.records.map((record) => (
                      <RecordCard key={record.id} record={record} />
                    ))
                  )}
                </div>

                {accessFor === member.id && canManageStaff ? (
                  <RoleAccessPanel
                    staff={member}
                    roleOptions={roleOptions}
                    onDone={async (summaryMessage) => {
                      setMessage(summaryMessage);
                      setAccessFor(null);
                      await reloadStaff();
                    }}
                  />
                ) : null}

                {payFor === member.id && canManageStaff ? (
                  <AwardPaySetupPanel
                    staff={member}
                    onDone={async (summaryMessage) => {
                      setMessage(summaryMessage);
                      setPayFor(null);
                      await reloadStaff();
                    }}
                  />
                ) : null}

                {addingRecordFor === member.id && canManageStaff ? (
                  <AddRecordPanel
                    staffId={member.id}
                    onDone={async () => {
                      setAddingRecordFor(null);
                      await reloadStaff();
                    }}
                  />
                ) : null}

                {notesFor === member.id && canManageStaff ? (
                  <ManagerNotesPanel
                    staffId={member.id}
                    staffName={`${member.firstName} ${member.lastName}`}
                  />
                ) : null}

                {historyFor === member.id && canViewManagementHistory ? (
                  <ManagementHistoryPanel
                    staffId={member.id}
                    staffName={`${member.firstName} ${member.lastName}`}
                  />
                ) : null}
              </article>
            ))}
          </div>
      </Card>
    </div>
  );
}

const NOTE_MAX_LENGTH = 2000;
const STAFF_PAY_NOTE_MAX_LENGTH = 1000;
const APP_ACCESS_OPTIONS: Array<{ appId: AlmaAppId; label: string }> = [
  { appId: 'COMPLIANCE', label: 'Compliance' },
  { appId: 'STAFF', label: 'Staff' },
  { appId: 'STOCK', label: 'Stock' },
  { appId: 'REPORTS', label: 'Reports' },
  { appId: 'RESERVE', label: 'Reserve' },
  { appId: 'MARKETING', label: 'Marketing' },
  { appId: 'GIFTCARDS', label: 'Gift Cards' },
  { appId: 'TRAINING', label: 'Academy' },
  { appId: 'SETTINGS', label: 'Settings' }
];

const APP_ACCESS_ROLE_OPTIONS = [
  { label: 'User', value: 'USER' },
  { label: 'Manager', value: 'MANAGER' },
  { label: 'Admin', value: 'ADMIN' }
];

const EMPLOYMENT_TYPE_OPTIONS: Array<{ label: string; value: StaffAwardEmploymentType }> = [
  { label: 'Casual', value: 'CASUAL' },
  { label: 'Part-time', value: 'PART_TIME' },
  { label: 'Full-time', value: 'FULL_TIME' }
];

const MANUAL_PAY_FREQUENCY_OPTIONS: Array<{ label: string; value: ManualFullTimePayFrequency }> = [
  { label: 'Annual salary', value: 'ANNUAL_SALARY' },
  { label: 'Hourly full-time rate', value: 'HOURLY_FULL_TIME' }
];

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';

  return date.toLocaleString('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function formatMoney(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return 'Not available';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD'
  }).format(cents / 100);
}

function dateLabel(value: string | null | undefined) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-AU', { dateStyle: 'medium' });
}

function currentPayProfile(staff: StaffProfile): StaffPayProfile {
  const award = AWARD_RATE_SETS.find((item) => item.awardCode === DEFAULT_STAFF_AWARD_CODE)!;
  const classification = award.classifications.find(
    (item) => item.id === DEFAULT_STAFF_AWARD_CLASSIFICATION
  ) ?? award.classifications[0]!;

  return staff.payProfile ?? {
    id: null,
    staffProfileId: staff.id,
    awardCode: award.awardCode,
    awardName: award.awardName,
    awardClassification: classification.id,
    employmentType: 'CASUAL',
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

function accessRows(appAccess: StaffAppAccess[]) {
  const existing = new Map(appAccess.map((access) => [access.appId, access]));
  return APP_ACCESS_OPTIONS.map(({ appId }) => {
    const row = existing.get(appId);
    return {
      appId,
      status: row?.status ?? 'DISABLED',
      role: row?.role ?? 'USER',
      permissions: row?.permissions ?? {},
      notes: row?.notes ?? ''
    };
  });
}

function RoleAccessPanel({
  staff,
  roleOptions,
  onDone
}: {
  staff: StaffProfile;
  roleOptions: Array<{ label: string; value: string }>;
  onDone: (message: string) => void | Promise<void>;
}) {
  const [roleTitle, setRoleTitle] = useState(staff.roleTitle);
  const [apps, setApps] = useState(accessRows(staff.appAccess));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving || roleTitle.trim().length < 2) return;
    setSaving(true);
    setError(null);
    try {
      await api<StaffProfile>(`/api/staff/${staff.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ roleTitle: roleTitle.trim() })
      });
      await api<StaffProfile>(`/api/staff/${staff.id}/app-access`, {
        method: 'PUT',
        body: JSON.stringify({ apps })
      });
      await onDone(`Role and app access updated for ${staff.firstName} ${staff.lastName}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update role/access.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id={`role-access-${staff.id}`}
      aria-label={`Role and app access for ${staff.firstName} ${staff.lastName}`}
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 10,
        background: 'var(--color-surface-muted)',
        border: '1px solid var(--color-border)'
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>Role and access</strong>
        <p className="subtle" style={{ margin: '4px 0 0' }}>
          Manager-only controls for the staff role and Alma app access.
        </p>
      </div>

      <div className="form-grid two">
        <Select
          label="Role"
          value={roleTitle}
          onChange={(event) => setRoleTitle(event.target.value)}
          options={roleOptions}
        />
        <Input
          label="Custom role"
          value={roleTitle}
          onChange={(event) => setRoleTitle(event.target.value)}
          hint="Use an existing role or type the exact role title to store on this staff profile."
        />
      </div>

      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {apps.map((row, index) => {
          const appLabel = APP_ACCESS_OPTIONS.find((item) => item.appId === row.appId)?.label ?? row.appId;
          return (
            <div
              key={row.appId}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 8,
                alignItems: 'end',
                padding: 8,
                border: '1px solid var(--color-border)',
                borderRadius: 10,
                background: 'var(--color-surface)'
              }}
            >
              <strong style={{ fontSize: 13 }}>{appLabel}</strong>
              <Select
                label="Status"
                value={row.status}
                onChange={(event) =>
                  setApps((current) =>
                    current.map((item, rowIndex) =>
                      rowIndex === index
                        ? { ...item, status: event.target.value as StaffAppAccess['status'] }
                        : item
                    )
                  )
                }
                options={[
                  { label: 'Enabled', value: 'ENABLED' },
                  { label: 'Pending', value: 'PENDING' },
                  { label: 'Disabled', value: 'DISABLED' }
                ]}
              />
              <Select
                label="Role"
                value={row.role}
                onChange={(event) =>
                  setApps((current) =>
                    current.map((item, rowIndex) =>
                      rowIndex === index ? { ...item, role: event.target.value } : item
                    )
                  )
                }
                options={APP_ACCESS_ROLE_OPTIONS}
              />
            </div>
          );
        })}
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      <div className="toolbar-right">
        <Button type="button" onClick={() => void save()} disabled={saving || roleTitle.trim().length < 2}>
          {saving ? 'Saving…' : 'Save role/access'}
        </Button>
      </div>
    </section>
  );
}

function AwardPaySetupPanel({
  staff,
  onDone
}: {
  staff: StaffProfile;
  onDone: (message: string) => void | Promise<void>;
}) {
  const initialProfile = currentPayProfile(staff);
  const [awardCode, setAwardCode] = useState<AustralianAwardCode>(initialProfile.awardCode);
  const [classificationId, setClassificationId] = useState(initialProfile.awardClassification);
  const [employmentType, setEmploymentType] = useState<StaffAwardEmploymentType>(initialProfile.employmentType);
  const [manualPay, setManualPay] = useState(
    initialProfile.manualFullTimePayAmountCents
      ? String(initialProfile.manualFullTimePayAmountCents / 100)
      : ''
  );
  const [manualFrequency, setManualFrequency] = useState<ManualFullTimePayFrequency>(
    initialProfile.manualFullTimePayFrequency ?? 'ANNUAL_SALARY'
  );
  const [manualNote, setManualNote] = useState(initialProfile.manualFullTimePayNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const award = AWARD_RATE_SETS.find((item) => item.awardCode === awardCode) ?? AWARD_RATE_SETS[0]!;
  const classification = award.classifications.find((item) => item.id === classificationId) ?? award.classifications[0]!;
  const manualPayCents = Math.round(Number(manualPay) * 100);
  const fullTime = employmentType === 'FULL_TIME';
  const manualPayInvalid = fullTime && (!Number.isFinite(manualPayCents) || manualPayCents <= 0);

  function changeAward(nextAwardCode: AustralianAwardCode) {
    const nextAward = AWARD_RATE_SETS.find((item) => item.awardCode === nextAwardCode) ?? AWARD_RATE_SETS[0]!;
    setAwardCode(nextAward.awardCode);
    setClassificationId(nextAward.classifications[0]?.id ?? '');
  }

  async function save() {
    if (saving || manualPayInvalid) return;
    const payload: StaffPayProfileInput = {
      awardCode,
      awardClassification: classification.id,
      employmentType,
      payMode: fullTime ? 'MANUAL_FULL_TIME' : 'AWARD',
      manualFullTimePayAmountCents: fullTime ? manualPayCents : null,
      manualFullTimePayFrequency: fullTime ? manualFrequency : null,
      manualFullTimePayNote: fullTime ? manualNote.trim() : ''
    };

    setSaving(true);
    setError(null);
    try {
      await api<StaffProfile>(`/api/staff/${staff.id}/pay-profile`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      await onDone(`Award pay setup updated for ${staff.firstName} ${staff.lastName}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update award pay setup.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id={`award-pay-${staff.id}`}
      aria-label={`Award pay setup for ${staff.firstName} ${staff.lastName}`}
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 10,
        background: 'var(--color-surface-muted)',
        border: '1px solid var(--color-border)'
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>Award pay setup</strong>
        <p className="subtle" style={{ margin: '4px 0 0' }}>
          Default staff to current Fair Work award rates. Full-time staff can have an agreed manual pay amount recorded while retaining the award classification as a compliance reference.
        </p>
      </div>

      <div className="form-grid two">
        <Select
          label="Award"
          value={awardCode}
          onChange={(event) => changeAward(event.target.value as AustralianAwardCode)}
          options={AWARD_RATE_SETS.map((item) => ({
            label: `${item.awardName} [${item.awardCode}]`,
            value: item.awardCode
          }))}
        />
        <Select
          label="Classification"
          value={classification.id}
          onChange={(event) => setClassificationId(event.target.value)}
          options={award.classifications.map((item) => ({
            label: item.label,
            value: item.id
          }))}
        />
        <Select
          label="Employment type"
          value={employmentType}
          onChange={(event) => setEmploymentType(event.target.value as StaffAwardEmploymentType)}
          options={EMPLOYMENT_TYPE_OPTIONS}
        />
      </div>

      <div
        style={{
          marginTop: 12,
          padding: 10,
          borderRadius: 10,
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface)'
        }}
      >
        <strong style={{ fontSize: 13 }}>Award rate reference</strong>
        <p className="subtle" style={{ margin: '6px 0 0' }}>
          Base ordinary hourly rate: {formatMoney(classification.ordinaryHourlyRateCents)}
          {employmentType === 'CASUAL'
            ? ` · Casual loaded hourly rate: ${formatMoney(classification.casualLoadedHourlyRateCents)}`
            : ''}
        </p>
        <p className="subtle" style={{ margin: '4px 0 0' }}>
          {award.sourceLabel}. Effective from {dateLabel(award.rateEffectiveFrom)}. Version {award.rateSetVersion}.
        </p>
        <p className="subtle" style={{ margin: '4px 0 0' }}>
          Penalty rates, overtime, allowances, public holiday rules, juniors, apprentices and supported wage arrangements are not calculated in this pass.
        </p>
        {initialProfile.isDefaulted ? (
          <p className="subtle" style={{ margin: '4px 0 0' }}>
            This profile is using the visible default until a manager saves explicit pay setup.
          </p>
        ) : null}
      </div>

      {fullTime ? (
        <div className="form-grid two" style={{ marginTop: 12 }}>
          <Input
            label="Agreed full-time pay"
            type="number"
            min="0"
            step="0.01"
            value={manualPay}
            onChange={(event) => setManualPay(event.target.value)}
            hint="Required for full-time manual pay. Enter dollars, not cents."
          />
          <Select
            label="Pay frequency"
            value={manualFrequency}
            onChange={(event) => setManualFrequency(event.target.value as ManualFullTimePayFrequency)}
            options={MANUAL_PAY_FREQUENCY_OPTIONS}
          />
          <Textarea
            label="Manual pay note"
            rows={3}
            maxLength={STAFF_PAY_NOTE_MAX_LENGTH}
            value={manualNote}
            onChange={(event) => setManualNote(event.target.value)}
            hint={`${manualNote.trim().length}/${STAFF_PAY_NOTE_MAX_LENGTH} characters`}
          />
        </div>
      ) : null}

      {manualPayInvalid ? <p className="error-text">Enter a positive manual full-time pay amount.</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      <div className="toolbar-right">
        <Button type="button" onClick={() => void save()} disabled={saving || manualPayInvalid}>
          {saving ? 'Saving…' : 'Save award pay setup'}
        </Button>
      </div>
    </section>
  );
}

function MergeDuplicatesPanel({
  selectedStaff,
  onCancel,
  onDone
}: {
  selectedStaff: StaffProfile[];
  onCancel: () => void;
  onDone: (message: string) => void | Promise<void>;
}) {
  const [canonicalId, setCanonicalId] = useState(selectedStaff[0]?.id ?? '');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const duplicates = selectedStaff.filter((member) => member.id !== canonicalId);
  const canMerge = selectedStaff.length >= 2 && canonicalId && confirmation.trim() === 'MERGE STAFF';

  async function merge() {
    if (!canMerge || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api('/api/staff/merge', {
        method: 'POST',
        body: JSON.stringify({
          canonicalStaffProfileId: canonicalId,
          duplicateStaffProfileIds: duplicates.map((member) => member.id),
          confirmation
        })
      });
      await onDone(`${duplicates.length} duplicate staff profile${duplicates.length === 1 ? '' : 's'} merged and archived.`);
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : 'Failed to merge staff profiles.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      style={{
        margin: 12,
        padding: 12,
        borderRadius: 10,
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface-muted)'
      }}
    >
      <div style={{ marginBottom: 10 }}>
        <strong style={{ fontSize: 13 }}>Merge duplicate staff profiles</strong>
        <p className="subtle" style={{ margin: '4px 0 0' }}>
          Choose the profile to keep. The selected duplicate profiles will be linked to the kept profile and removed from the active staff list where possible.
        </p>
      </div>

      {selectedStaff.length < 2 ? (
        <p className="error-text">Select at least two staff profiles before merging duplicates.</p>
      ) : (
        <>
          <Select
            label="Profile to keep"
            value={canonicalId}
            onChange={(event) => setCanonicalId(event.target.value)}
            options={selectedStaff.map((member) => ({
              label: `${member.firstName} ${member.lastName} · ${member.email ?? 'no email'} · ${member.venue ?? 'unassigned venue'}`,
              value: member.id
            }))}
          />
          <div style={{ marginTop: 10 }}>
            <strong style={{ fontSize: 13 }}>Profiles to archive/link</strong>
            <ul className="subtle" style={{ marginTop: 6 }}>
              {duplicates.map((member) => (
                <li key={member.id}>
                  {member.firstName} {member.lastName} · {member.email ?? 'no email'} · {member.venue ?? 'unassigned venue'}
                </li>
              ))}
            </ul>
            <p className="subtle" style={{ marginTop: 8 }}>
              Compliance records, manager notes and non-conflicting app/training access are moved to the kept profile. Roster, timesheet, tip payment and onboarding invite history stays attached to archived duplicates for audit history.
            </p>
          </div>
          <Input
            label="Type MERGE STAFF to confirm"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </>
      )}

      {error ? <p className="error-text">{error}</p> : null}
      <div className="toolbar-right">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void merge()} disabled={!canMerge || saving}>
          {saving ? 'Merging…' : 'Merge duplicates'}
        </Button>
      </div>
    </section>
  );
}

function ManagerNotesPanel({
  staffId,
  staffName
}: {
  staffId: string;
  staffName: string;
}) {
  const notes = useAsync<StaffManagerNote[]>(
    () => api(`/api/staff/${staffId}/manager-notes`),
    [staffId]
  );
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const trimmedBody = body.trim();
  const tooLong = trimmedBody.length > NOTE_MAX_LENGTH;

  async function saveNote() {
    if (saving || !trimmedBody || tooLong) return;

    setSaving(true);
    setSaveError(null);
    try {
      await api<StaffManagerNote>(`/api/staff/${staffId}/manager-notes`, {
        method: 'POST',
        body: JSON.stringify({ body: trimmedBody })
      });
      setBody('');
      await notes.reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save note.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id={`manager-notes-${staffId}`}
      aria-label={`Manager notes for ${staffName}`}
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 10,
        background: 'var(--color-surface-muted)',
        border: '1px solid var(--color-border)'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 10
        }}
      >
        <div>
          <strong style={{ fontSize: 13 }}>Manager notes for {staffName}</strong>
          <p className="subtle" style={{ margin: '4px 0 0' }}>
            Keep notes factual, relevant, and work-related.
          </p>
        </div>
        <Badge tone="muted">{notes.data?.length ?? 0} notes</Badge>
      </div>

      <Textarea
        id={`manager-note-${staffId}`}
        label="Add a note"
        rows={3}
        maxLength={NOTE_MAX_LENGTH}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        hint={`${trimmedBody.length}/${NOTE_MAX_LENGTH} characters`}
      />
      {tooLong ? (
        <p className="error-text">Manager notes must be {NOTE_MAX_LENGTH} characters or fewer.</p>
      ) : null}
      {saveError ? <p className="error-text">{saveError}</p> : null}
      <div className="toolbar-right">
        <Button
          type="button"
          onClick={() => void saveNote()}
          disabled={saving || !trimmedBody || tooLong}
        >
          {saving ? 'Saving…' : 'Add note'}
        </Button>
      </div>

      <div style={{ marginTop: 12 }}>
        {notes.loading ? <Spinner label="Loading manager notes…" /> : null}
        {notes.error ? <p className="error-text">{notes.error}</p> : null}
        {!notes.loading && !notes.error && (notes.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<IconStaff size={20} />}
            title="No manager notes yet"
            description="Internal staff notes added by managers will appear here."
          />
        ) : null}
        {!notes.loading && !notes.error && notes.data?.length ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {notes.data.map((note) => (
              <article
                key={note.id}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)'
                }}
              >
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{note.body}</p>
                <p className="subtle" style={{ margin: '8px 0 0', fontSize: 12 }}>
                  {note.createdByName}
                  {note.createdByEmail ? ` · ${note.createdByEmail}` : ''} ·{' '}
                  {formatDateTime(note.createdAt)}
                </p>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ManagementHistoryPanel({
  staffId,
  staffName
}: {
  staffId: string;
  staffName: string;
}) {
  const events = useAsync<StaffManagementEvent[]>(
    () => api(`/api/staff/${staffId}/management-events`),
    [staffId]
  );

  return (
    <section
      id={`management-history-${staffId}`}
      aria-label={`Management audit trail for ${staffName}`}
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 10,
        background: 'var(--color-surface-muted)',
        border: '1px solid var(--color-border)'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 10
        }}
      >
        <div>
          <strong style={{ fontSize: 13 }}>Management audit trail for {staffName}</strong>
          <p className="subtle" style={{ margin: '4px 0 0' }}>
            Admin-only history for role, access, pay setup and duplicate merge changes.
          </p>
        </div>
        <Badge tone="muted">{events.data?.length ?? 0} events</Badge>
      </div>

      {events.loading ? <Spinner label="Loading management audit trail…" /> : null}
      {events.error ? <p className="error-text">{events.error}</p> : null}
      {!events.loading && !events.error && (events.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<IconStaff size={20} />}
          title="No management events yet"
          description="Role, access, pay setup and duplicate merge events will appear here."
        />
      ) : null}
      {!events.loading && !events.error && events.data?.length ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {events.data.map((event) => (
            <article
              key={event.id}
              style={{
                padding: 10,
                borderRadius: 10,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13 }}>{event.eventType.replaceAll('_', ' ')}</strong>
                <span className="subtle" style={{ fontSize: 12 }}>{formatDateTime(event.createdAt)}</span>
              </div>
              <p style={{ margin: '6px 0 0' }}>{event.summary}</p>
              <p className="subtle" style={{ margin: '8px 0 0', fontSize: 12 }}>
                {event.createdByName ?? 'Unknown admin'}
                {event.createdByEmail ? ` · ${event.createdByEmail}` : ''}
              </p>
              {Object.keys(event.metadata ?? {}).length > 0 ? (
                <pre
                  style={{
                    margin: '8px 0 0',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    fontSize: 12,
                    color: 'var(--color-text-subtle)'
                  }}
                >
                  {JSON.stringify(event.metadata, null, 2)}
                </pre>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RecordCard({ record }: { record: StaffComplianceRecord }) {
  const expired =
    record.expiryDate && new Date(record.expiryDate).getTime() < Date.now();
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        padding: 10,
        borderRadius: 10,
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)'
      }}
    >
      <div
        style={{
          width: 60,
          height: 60,
          flex: 'none',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--color-surface-hover)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--color-text-subtle)',
          border: '1px solid var(--color-border)'
        }}
      >
        {record.documentUrl ? (
          <img
            src={record.documentUrl}
            alt={record.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <IconCamera size={22} />
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <strong style={{ fontSize: 13 }}>{record.title}</strong>
        <span className="subtle" style={{ fontSize: 12 }}>
          {record.recordType.replace('_', ' ')}
          {record.issuer ? ` · ${record.issuer}` : ''}
        </span>
        <span className="subtle" style={{ fontSize: 12 }}>
          {record.expiryDate
            ? `Expires ${new Date(record.expiryDate).toLocaleDateString()}`
            : 'No expiry'}
        </span>
        <Badge tone={expired ? 'danger' : record.status === 'PENDING' ? 'indigo' : 'positive'}>
          {expired ? 'EXPIRED' : record.status}
        </Badge>
      </div>
    </div>
  );
}

function AddRecordPanel({
  staffId,
  onDone
}: {
  staffId: string;
  onDone: () => void | Promise<void>;
}) {
  const [recordType, setRecordType] = useState<StaffRecordType>('RSA');
  const [title, setTitle] = useState('RSA Certificate');
  const [expiryDate, setExpiryDate] = useState('');
  const [certificateNumber, setCertificateNumber] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/staff/${staffId}/records`, {
        method: 'POST',
        body: JSON.stringify({
          recordType,
          title,
          certificateNumber,
          expiryDate,
          status: documentUrl ? 'APPROVED' : 'PENDING',
          documentUrl,
          documentName
        })
      });
      await onDone();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : 'Failed to save record.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 10,
        background: 'var(--color-surface-muted)',
        border: '1px solid var(--color-border)'
      }}
    >
      <div className="form-grid two">
        <Select
          label="Record type"
          value={recordType}
          onChange={(event) => setRecordType(event.target.value as StaffRecordType)}
          options={recordTypeOptions}
        />
        <Input
          label="Record title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
        <Input
          label="Certificate #"
          value={certificateNumber}
          onChange={(event) => setCertificateNumber(event.target.value)}
        />
        <Input
          label="Expiry date"
          type="date"
          value={expiryDate}
          onChange={(event) => setExpiryDate(event.target.value)}
        />
      </div>
      <div style={{ marginTop: 10 }}>
        <PhotoField
          value={documentUrl}
          onChange={(next, meta) => {
            setDocumentUrl(next);
            setDocumentName(next ? meta.name : '');
          }}
        />
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="toolbar-right">
        <Button type="button" variant="ghost" onClick={() => void onDone()}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={saving || title.trim().length < 2}
        >
          {saving ? 'Saving…' : 'Save record'}
        </Button>
      </div>
    </div>
  );
}
