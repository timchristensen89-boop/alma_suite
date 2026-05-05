import { useState } from 'react';
import type {
  StaffComplianceRecord,
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
  StatCard
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

export function StaffPage() {
  const staff = useAsync<StaffProfile[]>(() => api('/api/staff'), []);
  const summary = useAsync<StaffSummary>(() => api('/api/staff/meta'), []);

  const [message, setMessage] = useState('');
  const [addingRecordFor, setAddingRecordFor] = useState<string | null>(null);
  const visibleStaff = staff.data ?? [];

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
                void staff.reload();
                void summary.reload();
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
          </div>

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
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <strong style={{ fontSize: 14 }}>
                      {member.firstName} {member.lastName}
                    </strong>
                    <span className="subtle">
                      {member.roleTitle} · {member.venue || 'Unassigned venue'}
                      {member.email ? ` · ${member.email}` : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Badge tone="muted">{member.records.length} records</Badge>
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

                {addingRecordFor === member.id ? (
                  <AddRecordPanel
                    staffId={member.id}
                    onDone={async () => {
                      setAddingRecordFor(null);
                      await Promise.all([staff.reload(), summary.reload()]);
                    }}
                  />
                ) : null}
              </article>
            ))}
          </div>
      </Card>
    </div>
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
