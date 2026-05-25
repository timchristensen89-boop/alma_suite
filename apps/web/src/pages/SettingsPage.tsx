import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ALMA_COMPLIANCE_DOCUMENTS,
  type AppSettingsPayload,
  type IntegrationConnectResponse,
  type IntegrationProviderStatus,
  type IntegrationStatusPayload
} from '@alma/shared';
import { ActionFeedback, Badge, Button, Card, EmptyState, Input, Spinner } from '@alma/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { SETTINGS_WEB_URL, STAFF_WEB_URL } from '../config/suiteLinks';
import { IconArrowRight, IconHandbook, IconPlus, IconRefresh } from '../lib/icons';

type Venue = AppSettingsPayload['venues'][number];

type Tab = 'org' | 'venues' | 'integrations' | 'notifications' | 'handbook' | 'account';
type SettingsFeedback = { message: string | null; tone: 'success' | 'error' };

const TABS: { key: Tab; label: string; adminOnly?: boolean }[] = [
  { key: 'org', label: 'Organisation', adminOnly: true },
  { key: 'venues', label: 'Venues', adminOnly: true },
  { key: 'integrations', label: 'Integrations', adminOnly: true },
  { key: 'notifications', label: 'Notifications', adminOnly: true },
  { key: 'handbook', label: 'Handbook', adminOnly: true },
  { key: 'account', label: 'My account' }
];

const ADMIN_HANDOFF_LINKS = [
  { label: 'Handbook editing', href: '/handbook' },
  { label: 'Checklist templates', href: '/checklist-templates' },
  { label: 'Audit templates', href: '/audit-templates' },
  { label: 'Integrations', href: '/integrations' },
  { label: 'Xero', href: '/integrations/xero' }
];

function blankVenue(): Venue {
  return { name: '', address: '', phone: '' };
}

export function SettingsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>(user?.isAdmin ? 'org' : 'account');
  const [settings, setSettings] = useState<AppSettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api<AppSettingsPayload>('/api/settings');
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visibleTabs = useMemo(
    () => TABS.filter((t) => !t.adminOnly || user?.isAdmin),
    [user?.isAdmin]
  );
  const staffSettingsHref = STAFF_WEB_URL ? `${STAFF_WEB_URL.replace(/\/+$/, '')}/settings` : '';
  const adminBaseHref = SETTINGS_WEB_URL ? SETTINGS_WEB_URL.replace(/\/+$/, '') : '/admin';
  const adminHref = `${adminBaseHref}/`;
  const adminRouteHref = (path: string) =>
    SETTINGS_WEB_URL ? `${adminBaseHref}${path}` : `/admin${path}`;

  async function save(patch: Partial<AppSettingsPayload>, target: string) {
    if (!settings) return;
    setSaving(true);
    setFeedbackTarget(target);
    setError(null);
    setOk(null);
    try {
      const data = await api<AppSettingsPayload>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });
      setSettings(data);
      setOk('Saved');
      window.setTimeout(() => {
        setOk(null);
        setFeedbackTarget(null);
      }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !settings) {
    return (
      <div className="page-stack">
        <Card>
          <Spinner />
        </Card>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="page-stack">
        <Card>
          <EmptyState
            icon={<IconRefresh size={22} />}
            title="Couldn't load settings"
            description={error ?? 'Try again in a moment.'}
            action={<Button onClick={load}>Retry</Button>}
          />
        </Card>
      </div>
    );
  }

  const feedbackFor = (target: string): SettingsFeedback | undefined =>
    feedbackTarget === target ? { message: error ?? ok, tone: error ? 'error' : 'success' } : undefined;

  return (
    <div className="page-stack">
      <section className="hero">
        <div className="hero-text">
          <p className="page-header-eyebrow">Settings</p>
          <h1>{settings.orgName}</h1>
          <p>Setup and configuration now live in Alma Admin. Compliance stays focused on daily checks, audits, incidents and handbook reading.</p>
        </div>
        <div className="hero-actions">
          {user?.isAdmin ? (
            <Button type="button" onClick={() => { window.location.href = adminHref; }}>
              Open Alma Admin
            </Button>
          ) : null}
          {ok && !feedbackTarget ? <Badge tone="positive" dot>{ok}</Badge> : null}
          {saving ? <Badge tone="info">Saving…</Badge> : null}
        </div>
      </section>

      {user?.isAdmin ? (
        <Card
          title="Managed in Alma Admin"
          subtitle="Business-wide setup, app configuration, integrations, access, audit and health now live in the Admin app."
          action={
            <Button type="button" variant="secondary" onClick={() => { window.location.href = adminHref; }}>
              Open Alma Admin
            </Button>
          }
        >
          <p className="subtle">
            Setup and configuration now live in Alma Admin. Organisation, venues, integrations, notifications, handbook and template setup should be managed there.
            {staffSettingsHref ? (
              <>
                {' '}
                <a href={staffSettingsHref}>
                  Open Staff Settings
                </a>
              </>
            ) : null}
          </p>
          <div className="admin-card-list">
            {ADMIN_HANDOFF_LINKS.map((link) => (
              <a key={link.href} className="admin-link-card" href={adminRouteHref(link.href)}>
                <span>
                  <strong>{link.label}</strong>
                  <small>Open this setup page in Alma Admin.</small>
                </span>
                <IconArrowRight size={16} />
              </a>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="settings-tabs">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`settings-tab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && !feedbackTarget ? (
        <Card>
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      {tab === 'org' && user?.isAdmin ? <OrgTab settings={settings} onSave={save} feedback={feedbackFor('org')} /> : null}
      {tab === 'venues' && user?.isAdmin ? <VenuesTab settings={settings} onSave={save} feedback={feedbackFor('venues')} /> : null}
      {tab === 'integrations' && user?.isAdmin ? (
        <IntegrationsTab settings={settings} onSave={save} feedback={feedbackFor('integrations')} />
      ) : null}
      {tab === 'notifications' && user?.isAdmin ? (
        <NotificationsTab settings={settings} onSave={save} feedback={feedbackFor('notifications')} />
      ) : null}
      {tab === 'handbook' && user?.isAdmin ? <HandbookTab /> : null}
      {tab === 'account' ? <AccountTab /> : null}
    </div>
  );
}

/* ---------- Organisation ---------- */
function OrgTab({
  settings,
  onSave,
  feedback
}: {
  settings: AppSettingsPayload;
  onSave: (patch: Partial<AppSettingsPayload>, target: string) => void;
  feedback?: SettingsFeedback;
}) {
  const [orgName, setOrgName] = useState(settings.orgName);
  const [name, setName] = useState(settings.primaryContactName ?? '');
  const [email, setEmail] = useState(settings.primaryContactEmail ?? '');
  const [phone, setPhone] = useState(settings.primaryContactPhone ?? '');

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      orgName,
      primaryContactName: name,
      primaryContactEmail: email,
      primaryContactPhone: phone
    }, 'org');
  }

  return (
    <Card title="Organisation" subtitle="Details shown in reports and emails">
      <form className="page-stack compact" onSubmit={submit}>
        <Input label="Organisation name" value={orgName} onChange={(e) => setOrgName(e.currentTarget.value)} required />
        <Input label="Primary contact name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Input label="Primary contact email" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <Input label="Primary contact phone" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
        <div className="inline-actions">
          <Button type="submit">Save</Button>
          <ActionFeedback message={feedback?.message} tone={feedback?.tone} />
        </div>
      </form>
    </Card>
  );
}

/* ---------- Venues ---------- */
function VenuesTab({
  settings,
  onSave,
  feedback
}: {
  settings: AppSettingsPayload;
  onSave: (patch: Partial<AppSettingsPayload>, target: string) => void;
  feedback?: SettingsFeedback;
}) {
  const [venues, setVenues] = useState<Venue[]>(settings.venues);

  function update(index: number, patch: Partial<Venue>) {
    setVenues((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }

  function remove(index: number) {
    setVenues((prev) => prev.filter((_, i) => i !== index));
  }

  function add() {
    setVenues((prev) => [...prev, blankVenue()]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({ venues: venues.filter((v) => v.name.trim()) }, 'venues');
  }

  return (
    <Card
      title="Venues"
      subtitle="Locations attached to staff, fridges, and audits"
      action={
        <Button size="sm" variant="secondary" leftIcon={<IconPlus size={14} />} onClick={add}>
          Add venue
        </Button>
      }
    >
      <form className="page-stack compact" onSubmit={submit}>
        {venues.length === 0 ? (
          <p className="subtle">No venues yet. Add one so you can attach records to it.</p>
        ) : (
          venues.map((venue, index) => (
            <div key={index} className="venue-row">
              <Input
                label={index === 0 ? 'Name' : ''}
                value={venue.name}
                placeholder="e.g. Alma Avalon"
                onChange={(e) => update(index, { name: e.currentTarget.value })}
              />
              <Input
                label={index === 0 ? 'Address' : ''}
                value={venue.address ?? ''}
                onChange={(e) => update(index, { address: e.currentTarget.value })}
              />
              <Input
                label={index === 0 ? 'Phone' : ''}
                value={venue.phone ?? ''}
                onChange={(e) => update(index, { phone: e.currentTarget.value })}
              />
              <Button type="button" size="sm" variant="ghost" onClick={() => remove(index)}>
                Remove
              </Button>
            </div>
          ))
        )}
        <div className="inline-actions">
          <Button type="submit">Save venues</Button>
          <ActionFeedback message={feedback?.message} tone={feedback?.tone} />
        </div>
      </form>
    </Card>
  );
}

/* ---------- Integrations ---------- */
function integrationTone(status: IntegrationProviderStatus['status']) {
  if (status === 'CONNECTED') return 'positive';
  if (status === 'ERROR') return 'danger';
  if (status === 'NOT_CONFIGURED') return 'warning';
  return 'muted';
}

function ProviderSetupCard({
  provider,
  busy,
  onConnect
}: {
  provider: IntegrationProviderStatus;
  busy: string | null;
  onConnect: (provider: IntegrationProviderStatus['provider']) => void;
}) {
  const isBusy = busy === provider.provider;

  return (
    <div className="admin-provider-card">
      <div className="admin-status-line">
        <span>{provider.label}</span>
        <Badge tone={integrationTone(provider.status)}>{provider.status.replace(/_/g, ' ')}</Badge>
      </div>
      <p>Connection tokens are stored securely on the server and are never exposed in the browser.</p>
      <div>
        <strong>Powers</strong>
        <p>{provider.powers.join(', ')}</p>
      </div>
      <div>
        <strong>Account</strong>
        <p>{provider.providerAccountName ?? provider.providerAccountId ?? 'Not connected yet'}</p>
      </div>
      <div>
        <strong>Last sync</strong>
        <p>{provider.lastSyncAt ? new Date(provider.lastSyncAt).toLocaleString('en-AU') : 'No syncs yet'}</p>
      </div>
      <div>
        <strong>Webhooks</strong>
        <p>{provider.webhookConfigured ? 'Signature key configured' : 'Webhook verification key missing'}</p>
      </div>
      {provider.missingEnvVars.length ? (
        <div>
          <strong>Setup needed</strong>
          <p>{provider.missingEnvVars.join(', ')}</p>
        </div>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        disabled={provider.actionDisabled || isBusy}
        onClick={() => onConnect(provider.provider)}
      >
        {isBusy ? 'Opening...' : provider.actionLabel}
      </Button>
      {provider.connectBlockedReason ? <p className="muted">{provider.connectBlockedReason}</p> : null}
    </div>
  );
}

function IntegrationsTab({
  settings,
  onSave,
  feedback
}: {
  settings: AppSettingsPayload;
  onSave: (patch: Partial<AppSettingsPayload>, target: string) => void;
  feedback?: SettingsFeedback;
}) {
  const [key, setKey] = useState(settings.goveeApiKey ?? '');
  const [baseUrl, setBaseUrl] = useState(settings.goveeBaseUrl ?? 'https://openapi.api.govee.com');
  const [status, setStatus] = useState<IntegrationStatusPayload | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);

  async function loadIntegrationStatus() {
    try {
      const payload = await api<IntegrationStatusPayload>('/api/integrations');
      setStatus(payload);
      setStatusError(null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Could not load integration status.');
    }
  }

  useEffect(() => {
    void loadIntegrationStatus();
  }, []);

  async function connectProvider(provider: IntegrationProviderStatus['provider']) {
    setBusyProvider(provider);
    try {
      const payload = await api<IntegrationConnectResponse>(`/api/integrations/${provider}/connect`, {
        method: 'POST'
      });
      window.location.href = payload.authorizationUrl;
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Could not start integration connection.');
      setBusyProvider(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      // Only send the key if it was edited away from the masked value.
      goveeApiKey: key === (settings.goveeApiKey ?? '') ? undefined : key,
      goveeBaseUrl: baseUrl
    }, 'integrations');
  }

  return (
    <div className="page-stack compact">
      <Card title="Square and Xero" subtitle="Server-managed connections for live sales, invoices and future syncs">
        {statusError ? (
          <ActionFeedback tone="error" message={statusError} />
        ) : status ? (
          <div className="admin-grid two">
            <ProviderSetupCard provider={status.square} busy={busyProvider} onConnect={(provider) => void connectProvider(provider)} />
            <ProviderSetupCard provider={status.xero} busy={busyProvider} onConnect={(provider) => void connectProvider(provider)} />
          </div>
        ) : (
          <Spinner label="Loading integration status..." />
        )}
      </Card>

      <Card title="Govee" subtitle="External services that feed compliance data">
        <form className="page-stack compact" onSubmit={submit}>
        <Input
          label="govee API key"
          value={key}
          onChange={(e) => setKey(e.currentTarget.value)}
          placeholder="Paste a new key to replace"
          hint="Leave the masked value to keep the existing key. Paste a new key to replace it."
        />
        <Input
          label="govee API base URL"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.currentTarget.value)}
        />
        <div className="inline-actions">
          <Button type="submit">Save</Button>
          <ActionFeedback message={feedback?.message} tone={feedback?.tone} />
        </div>
        </form>
      </Card>
    </div>
  );
}

/* ---------- Notifications ---------- */
function NotificationsTab({
  settings,
  onSave,
  feedback
}: {
  settings: AppSettingsPayload;
  onSave: (patch: Partial<AppSettingsPayload>, target: string) => void;
  feedback?: SettingsFeedback;
}) {
  const [email, setEmail] = useState(settings.notifyEmail ?? '');
  const [overdue, setOverdue] = useState(settings.notifyOverdueIssues);
  const [staff, setStaff] = useState(settings.notifyExpiringStaff);
  const [temp, setTemp] = useState(settings.notifyOutOfRangeTemp);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      notifyEmail: email,
      notifyOverdueIssues: overdue,
      notifyExpiringStaff: staff,
      notifyOutOfRangeTemp: temp
    }, 'notifications');
  }

  return (
    <Card title="Notifications" subtitle="Where and when we get in touch">
      <form className="page-stack compact" onSubmit={submit}>
        <Input
          label="Notification email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        <label className="toggle-row">
          <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.currentTarget.checked)} />
          <span>Notify about overdue issues</span>
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={staff} onChange={(e) => setStaff(e.currentTarget.checked)} />
          <span>Notify about expiring staff records</span>
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={temp} onChange={(e) => setTemp(e.currentTarget.checked)} />
          <span>Notify about out-of-range temperatures</span>
        </label>
        <div className="inline-actions">
          <Button type="submit">Save</Button>
          <ActionFeedback message={feedback?.message} tone={feedback?.tone} />
        </div>
      </form>
    </Card>
  );
}

/* ---------- Handbook ---------- */
function HandbookTab() {
  const sections = [
    {
      title: 'Handbook editor',
      description: 'Admin owns handbook editing, publishing, and content updates.',
      to: '/admin/handbook'
    },
    {
      title: 'Org chart',
      description: 'View the live reporting structure and responsibilities.',
      to: '/handbook/org-chart'
    },
    {
      title: 'Guidelines',
      description: 'Open venue operating guidelines for service, safety, customers, and compliance.',
      to: '/handbook/guidelines'
    },
    {
      title: 'Maintenance contacts',
      description: 'Check who to call and what to try first when equipment or facilities need attention.',
      to: '/handbook/maintenance'
    }
  ];

  return (
    <div className="page-stack compact">
      <Card
        title="Handbook"
        subtitle="Staff can read the handbook from the Compliance sidebar. Admin owns editing."
        action={<IconHandbook size={22} />}
      >
        <div className="settings-link-grid">
          {sections.map((section) => (
            <Link key={section.to} to={section.to} className="settings-link-card">
              <span className="settings-link-icon">
                <IconHandbook size={18} />
              </span>
              <span className="settings-link-body">
                <strong>{section.title}</strong>
                <span>{section.description}</span>
              </span>
              <IconArrowRight className="settings-link-arrow" size={16} />
            </Link>
          ))}
        </div>
      </Card>

      <Card
        title="Imported document register"
        subtitle="Files brought in from Dropbox. Active checklists are live templates; older files are marked for review or archive."
      >
        <div className="settings-document-summary">
          <Badge tone="positive" dot>
            {ALMA_COMPLIANCE_DOCUMENTS.filter((doc) => doc.reviewStatus === 'active').length} active
          </Badge>
          <Badge tone="warning">
            {ALMA_COMPLIANCE_DOCUMENTS.filter((doc) => doc.reviewStatus === 'needs_review').length} needs review
          </Badge>
          <Badge tone="muted">
            {ALMA_COMPLIANCE_DOCUMENTS.filter((doc) => doc.reviewStatus === 'archive').length} archive/reference
          </Badge>
        </div>
        <div className="settings-document-list">
          {ALMA_COMPLIANCE_DOCUMENTS.map((document) => (
            <article key={`${document.venue}-${document.title}`} className="settings-document-row">
              <div className="settings-document-main">
                <strong>{document.title}</strong>
                <span>
                  {document.venue} · {document.category}
                </span>
                <span className="settings-document-path">{document.sourcePath}</span>
                <span>{document.notes}</span>
              </div>
              <Badge
                tone={
                  document.reviewStatus === 'active'
                    ? 'positive'
                    : document.reviewStatus === 'needs_review'
                      ? 'warning'
                      : 'muted'
                }
              >
                {document.reviewStatus === 'active'
                  ? 'Active'
                  : document.reviewStatus === 'needs_review'
                    ? 'Needs review'
                    : 'Archive'}
              </Badge>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ---------- Account (change password) ---------- */
function AccountTab() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setErr(null);
    setDone(null);
    if (newPassword !== confirm) {
      setErr('New password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setDone('Password updated.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (error) {
      setErr(
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Could not change password'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-stack compact">
      <Card title="You" subtitle="Signed in as">
        <ul className="detail-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          <li>
            <span>Name</span>
            <strong>{user ? `${user.firstName} ${user.lastName}` : '—'}</strong>
          </li>
          <li>
            <span>Role</span>
            <strong>{user?.roleTitle ?? '—'}</strong>
          </li>
          <li>
            <span>Email</span>
            <strong>{user?.email ?? '—'}</strong>
          </li>
          <li>
            <span>Access</span>
            <strong>{user?.isAdmin ? 'Admin' : 'Staff'}</strong>
          </li>
        </ul>
      </Card>

      <Card title="Change password">
        <form className="page-stack compact" onSubmit={submit}>
          <Input
            label="Current password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.currentTarget.value)}
            required
            maxLength={256}
          />
          <Input
            label="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
            required
            maxLength={256}
            hint="At least 8 characters."
          />
          <Input
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)}
            required
            maxLength={256}
          />
          <div className="inline-actions">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Updating…' : 'Update password'}
            </Button>
            <ActionFeedback message={err ?? done} tone={err ? 'error' : 'success'} />
          </div>
        </form>
      </Card>
    </div>
  );
}
