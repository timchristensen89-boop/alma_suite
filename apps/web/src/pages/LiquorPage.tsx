import { useMemo, useState, type FormEvent } from 'react';
import {
  liquorLicenceStatuses,
  liquorLicenceTypeLabels,
  liquorLicenceTypes,
  type AppSettingsPayload,
  type LiquorLicence,
  type LiquorLicenceStatus,
  type LiquorLicenceSummary,
  type LiquorLicenceType
} from '@alma/shared';
import {
  ActionFeedback,
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
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { canManage } from '../lib/rbac';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  IconClock,
  IconLicences,
  IconPlus,
  IconRefresh,
  IconTrash
} from '../lib/icons';

type FormState = {
  id: string | null;
  venue: string;
  licenceNumber: string;
  licenceType: LiquorLicenceType;
  status: LiquorLicenceStatus;
  licensee: string;
  issuer: string;
  issueDate: string;
  expiryDate: string;
  tradingHours: string;
  conditions: string;
  restrictions: string;
  notes: string;
  documentUrl: string;
  documentName: string;
};

function emptyForm(): FormState {
  return {
    id: null,
    venue: '',
    licenceNumber: '',
    licenceType: 'ON_PREMISES',
    status: 'ACTIVE',
    licensee: '',
    issuer: '',
    issueDate: '',
    expiryDate: '',
    tradingHours: '',
    conditions: '',
    restrictions: '',
    notes: '',
    documentUrl: '',
    documentName: ''
  };
}

const licenceTypeOptions = liquorLicenceTypes.map((value) => ({
  label: liquorLicenceTypeLabels[value],
  value
}));

const statusOptions = liquorLicenceStatuses.map((value) => ({
  label: value.charAt(0) + value.slice(1).toLowerCase(),
  value
}));

function toDateInput(iso: string | null) {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function licenceStatus(licence: LiquorLicence): {
  tone: 'positive' | 'warning' | 'danger' | 'muted' | 'indigo';
  label: string;
} {
  if (licence.status === 'SUSPENDED') return { tone: 'danger', label: 'Suspended' };
  if (licence.status === 'PENDING') return { tone: 'indigo', label: 'Pending' };

  if (licence.expiryDate) {
    const expiry = new Date(licence.expiryDate).getTime();
    const now = Date.now();
    const daysLeft = Math.round((expiry - now) / (1000 * 60 * 60 * 24));

    if (expiry < now || licence.status === 'EXPIRED') {
      return { tone: 'danger', label: 'Expired' };
    }
    if (daysLeft <= 30) {
      return { tone: 'warning', label: `Expires in ${daysLeft}d` };
    }
  }

  if (licence.status === 'EXPIRED') return { tone: 'danger', label: 'Expired' };
  return { tone: 'positive', label: 'Active' };
}

export function LiquorPage() {
  useDocumentTitle('Licences');
  const { user } = useAuth();
  const isManager = canManage(user);

  const licences = useAsync<LiquorLicence[]>(() => api('/api/liquor'), []);
  const summary = useAsync<LiquorLicenceSummary>(
    () => api('/api/liquor/summary'),
    []
  );
  const settings = useAsync<AppSettingsPayload>(() => api('/api/settings'), []);

  const [mode, setMode] = useState<'none' | 'form'>('none');
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const venueOptions = useMemo(() => {
    const fromSettings = (settings.data?.venues ?? []).map((v) => v.name);
    const fromLicences = (licences.data ?? []).map((l) => l.venue);
    return Array.from(new Set([...fromSettings, ...fromLicences].filter(Boolean)));
  }, [settings.data?.venues, licences.data]);

  const grouped = useMemo(() => {
    const map = new Map<string, LiquorLicence[]>();
    for (const licence of licences.data ?? []) {
      const key = licence.venue || 'Unassigned venue';
      const bucket = map.get(key) ?? [];
      bucket.push(licence);
      map.set(key, bucket);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [licences.data]);

  function openCreate() {
    setForm({ ...emptyForm(), venue: venueOptions[0] ?? '' });
    setError(null);
    setFormMessage(null);
    setMode('form');
  }

  function openEdit(licence: LiquorLicence) {
    setForm({
      id: licence.id,
      venue: licence.venue,
      licenceNumber: licence.licenceNumber,
      licenceType: licence.licenceType,
      status: licence.status,
      licensee: licence.licensee,
      issuer: licence.issuer,
      issueDate: toDateInput(licence.issueDate),
      expiryDate: toDateInput(licence.expiryDate),
      tradingHours: licence.tradingHours ?? '',
      conditions: licence.conditions ?? '',
      restrictions: licence.restrictions ?? '',
      notes: licence.notes ?? '',
      documentUrl: licence.documentUrl ?? '',
      documentName: licence.documentName ?? ''
    });
    setError(null);
    setFormMessage(null);
    setMode('form');
  }

  function closeForm() {
    setMode('none');
    setForm(emptyForm());
    setError(null);
    setFormMessage(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFormMessage(null);
    try {
      const payload = {
        venue: form.venue,
        licenceNumber: form.licenceNumber,
        licenceType: form.licenceType,
        status: form.status,
        licensee: form.licensee,
        issuer: form.issuer,
        issueDate: form.issueDate,
        expiryDate: form.expiryDate,
        tradingHours: form.tradingHours,
        conditions: form.conditions,
        restrictions: form.restrictions,
        notes: form.notes,
        documentUrl: form.documentUrl,
        documentName: form.documentName
      };

      if (form.id) {
        await api(`/api/liquor/${form.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
      } else {
        await api('/api/liquor', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      await Promise.all([licences.reload(), summary.reload()]);
      setFormMessage('Licence saved.');
      window.setTimeout(() => closeForm(), 900);
    } catch (submitError) {
      setFormMessage(
        submitError instanceof Error ? submitError.message : 'Could not save licence'
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteLicence(id: string) {
    if (!window.confirm('Delete this licence? This cannot be undone.')) return;
    setDeleting(id);
    try {
      await api(`/api/liquor/${id}`, { method: 'DELETE' });
      await Promise.all([licences.reload(), summary.reload()]);
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : 'Could not delete'
      );
    } finally {
      setDeleting(null);
    }
  }

  function patch<K extends keyof FormState>(key: K, next: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: next }));
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operating compliance"
        title="Licences and approvals"
        description="Liquor, outdoor seating, food business registrations, signage, fire safety, trade waste, and other operating approvals in one place."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<IconRefresh size={14} />}
              onClick={() => {
                void licences.reload();
                void summary.reload();
                void settings.reload();
              }}
            >
              Refresh
            </Button>
            {isManager ? (
              <Button leftIcon={<IconPlus size={14} />} onClick={openCreate}>
                Add licence
              </Button>
            ) : null}
          </>
        }
      />

      <div className="stats-grid">
        <StatCard
          label="Total licences"
          value={summary.data?.total ?? 0}
          hint="Across all venues"
          icon={<IconLicences size={16} />}
          loading={summary.loading}
        />
        <StatCard
          label="Active"
          value={summary.data?.active ?? 0}
          hint="Currently valid"
          icon={<IconLicences size={16} />}
          tone="positive"
          loading={summary.loading}
        />
        <StatCard
          label="Expiring in 30 days"
          value={summary.data?.expiringSoon ?? 0}
          hint="Action coming up"
          icon={<IconClock size={16} />}
          tone={(summary.data?.expiringSoon ?? 0) > 0 ? 'warning' : 'neutral'}
          loading={summary.loading}
        />
        <StatCard
          label="Expired"
          value={summary.data?.expired ?? 0}
          hint="Needs renewal"
          icon={<IconClock size={16} />}
          tone={(summary.data?.expired ?? 0) > 0 ? 'danger' : 'positive'}
          loading={summary.loading}
        />
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {mode === 'form' ? (
        <Card
          title={form.id ? 'Edit licence or approval' : 'Add a licence or approval'}
          subtitle="Venue-level permit details, approved areas, trading hours, expiry dates, and any operating conditions."
        >
          <form className="page-stack compact" onSubmit={submit}>
            <div className="form-grid two">
              <Select
                label="Venue"
                value={form.venue}
                onChange={(event) => patch('venue', event.target.value)}
                options={[
                  { label: 'Select venue', value: '' },
                  ...venueOptions.map((v) => ({ label: v, value: v }))
                ]}
                required
              />
              <Input
                label="Licence number"
                required
                value={form.licenceNumber}
                onChange={(event) => patch('licenceNumber', event.target.value)}
                placeholder="Licence, permit, or approval reference"
              />
              <Select
                label="Licence type"
                value={form.licenceType}
                onChange={(event) =>
                  patch('licenceType', event.target.value as LiquorLicenceType)
                }
                options={licenceTypeOptions}
              />
              <Select
                label="Status"
                value={form.status}
                onChange={(event) =>
                  patch('status', event.target.value as LiquorLicenceStatus)
                }
                options={statusOptions}
              />
              <Input
                label="Licensee"
                required
                value={form.licensee}
                onChange={(event) => patch('licensee', event.target.value)}
                placeholder="Legal entity, venue, or approval holder"
              />
              <Input
                label="Issuing authority"
                value={form.issuer}
                onChange={(event) => patch('issuer', event.target.value)}
              />
              <Input
                label="Issue date"
                type="date"
                value={form.issueDate}
                onChange={(event) => patch('issueDate', event.target.value)}
              />
              <Input
                label="Expiry date"
                type="date"
                value={form.expiryDate}
                onChange={(event) => patch('expiryDate', event.target.value)}
              />
            </div>

            <Textarea
              label="Trading hours"
              value={form.tradingHours}
              onChange={(event) => patch('tradingHours', event.target.value)}
              rows={2}
              placeholder="Approved trading hours, outdoor seating hours, or operating window"
            />

            <Textarea
              label="Conditions on the licence or approval"
              value={form.conditions}
              onChange={(event) => patch('conditions', event.target.value)}
              rows={3}
              placeholder="Noise controls, max outdoor seats, CCTV retention, approved area boundaries, display requirements…"
            />

            <Textarea
              label="Restrictions"
              value={form.restrictions}
              onChange={(event) => patch('restrictions', event.target.value)}
              rows={2}
              placeholder="No glassware outdoors, footpath clearances, music cut-off, renewal reminders…"
            />

            <Textarea
              label="Internal notes"
              value={form.notes}
              onChange={(event) => patch('notes', event.target.value)}
              rows={2}
            />

            <Input
              label="Document link (optional)"
              value={form.documentUrl}
              onChange={(event) => patch('documentUrl', event.target.value)}
              placeholder="https://…/licence-or-approval.pdf"
            />

            <div className="toolbar-right">
              <ActionFeedback
                message={formMessage}
                tone={formMessage?.includes('Could') || formMessage?.includes('not') ? 'error' : 'success'}
              />
              <Button type="button" variant="ghost" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add licence'}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {licences.loading ? (
        <Card>
          <Spinner label="Loading licences…" />
        </Card>
      ) : licences.data && licences.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconLicences size={22} />}
            title="No licences or approvals yet"
            description={
              isManager
                ? 'Add the first licence, permit, or approval so expiry dates and operating conditions sit with the compliance record.'
                : 'A manager needs to add licence and approval details before they show up here.'
            }
            action={
              isManager ? (
                <Button leftIcon={<IconPlus size={14} />} onClick={openCreate}>
                  Add licence
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="page-stack compact">
          {grouped.map(([venue, items]) => (
            <Card
              key={venue}
              title={venue}
              subtitle={`${items.length} ${items.length === 1 ? 'licence' : 'licences'}`}
            >
              <div className="liquor-list">
                {items.map((licence) => {
                  const badge = licenceStatus(licence);
                  return (
                    <article key={licence.id} className="liquor-row">
                      <div className="liquor-row-head">
                        <div className="liquor-row-title">
                          <strong>{licence.licenceNumber}</strong>
                          <Badge tone="muted">
                            {liquorLicenceTypeLabels[licence.licenceType]}
                          </Badge>
                          <Badge tone={badge.tone} dot>
                            {badge.label}
                          </Badge>
                        </div>
                        {isManager ? (
                          <div className="inline-actions">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => openEdit(licence)}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              leftIcon={<IconTrash size={14} />}
                              disabled={deleting === licence.id}
                              onClick={() => void deleteLicence(licence.id)}
                            >
                              {deleting === licence.id ? 'Deleting…' : 'Delete'}
                            </Button>
                          </div>
                        ) : null}
                      </div>

                      <div className="liquor-meta">
                        <span>
                          <span className="subtle">Holder</span>
                          <strong>{licence.licensee || '—'}</strong>
                        </span>
                        <span>
                          <span className="subtle">Issuer</span>
                          <strong>{licence.issuer}</strong>
                        </span>
                        <span>
                          <span className="subtle">Issued</span>
                          <strong>
                            {licence.issueDate
                              ? new Date(licence.issueDate).toLocaleDateString()
                              : '—'}
                          </strong>
                        </span>
                        <span>
                          <span className="subtle">Expires</span>
                          <strong>
                            {licence.expiryDate
                              ? new Date(licence.expiryDate).toLocaleDateString()
                              : 'No expiry on file'}
                          </strong>
                        </span>
                      </div>

                      {licence.tradingHours ? (
                        <div className="liquor-block">
                          <span className="subtle">Trading hours</span>
                          <p>{licence.tradingHours}</p>
                        </div>
                      ) : null}
                      {licence.conditions ? (
                        <div className="liquor-block">
                          <span className="subtle">Conditions</span>
                          <p>{licence.conditions}</p>
                        </div>
                      ) : null}
                      {licence.restrictions ? (
                        <div className="liquor-block">
                          <span className="subtle">Restrictions</span>
                          <p>{licence.restrictions}</p>
                        </div>
                      ) : null}
                      {licence.documentUrl ? (
                        <a
                          className="link"
                          href={licence.documentUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {licence.documentName || 'Open document'}
                        </a>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
