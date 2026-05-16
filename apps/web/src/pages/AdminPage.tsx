import { FormEvent, useEffect, useMemo, useState } from 'react';
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
import type {
  AdminAuditEventsPayload,
  AdminAuditEventSummary,
  AdminHandoffLink,
  AdminIntegrationsStatusPayload,
  AdminOverviewPayload,
  AdminSignalTone,
  AdminSystemHealthPayload,
  IntegrationConnectResponse,
  IntegrationProviderStatus,
  MarketingSocialAccount,
  MarketingSocialAccountStatus,
  SocialPlatform
} from '@alma/shared';
import { api, createSuiteHandoffUrl } from '../lib/api';
import {
  GIFTCARDS_WEB_URL,
  MARKETING_WEB_URL,
  REPORTS_WEB_URL,
  RESERVE_WEB_URL,
  STAFF_WEB_URL,
  STOCK_WEB_URL
} from '../config/suiteLinks';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  IconArrowRight,
  IconAudit,
  IconChecklist,
  IconClock,
  IconExternalLink,
  IconInbox,
  IconLicences,
  IconMail,
  IconRefresh,
  IconSettings,
  IconStaff,
  IconTemperature,
  IconUsers
} from '../lib/icons';

type AdminLoadState = {
  overview: AdminOverviewPayload | null;
  integrations: AdminIntegrationsStatusPayload | null;
  systemHealth: AdminSystemHealthPayload | null;
  socialAccounts: MarketingSocialAccount[];
};

type SocialAccountForm = {
  venue: string;
  platform: SocialPlatform;
  displayName: string;
  handle: string;
  externalAccountId: string;
  status: MarketingSocialAccountStatus;
  tokenSecretRef: string;
};

type SocialReadiness = {
  account: MarketingSocialAccount;
  ready: boolean;
  integrationStatus: string;
  checks: Array<{ label: string; ok: boolean; message: string }>;
};

type HumanAgentDemoResult = {
  mode: 'DEMO';
  delivered: boolean;
  tag: string;
  channel: string;
  message: string;
  guardrails: string[];
  simulatedAt: string;
};

const APP_URLS: Record<string, string> = {
  staff: STAFF_WEB_URL,
  stock: STOCK_WEB_URL,
  reports: REPORTS_WEB_URL,
  reserve: RESERVE_WEB_URL,
  marketing: MARKETING_WEB_URL,
  giftcards: GIFTCARDS_WEB_URL
};

const SOCIAL_PLATFORMS: SocialPlatform[] = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK'];
const SOCIAL_STATUSES: MarketingSocialAccountStatus[] = ['SETUP_REQUIRED', 'CONNECTED', 'EXPIRED', 'DISABLED', 'ERROR'];
const HUMAN_AGENT_SAMPLE_REPLY =
  'Hi, thanks for reaching out. I’ll check with the venue team and get back to you as soon as we confirm whether it has been found.';

function defaultSocialAccountForm(venue = 'Alma Avalon'): SocialAccountForm {
  return {
    venue,
    platform: 'FACEBOOK',
    displayName: '',
    handle: '',
    externalAccountId: '',
    status: 'SETUP_REQUIRED',
    tokenSecretRef: ''
  };
}

function socialAccountToForm(account: MarketingSocialAccount): SocialAccountForm {
  return {
    venue: account.venue,
    platform: account.platform,
    displayName: account.displayName,
    handle: account.handle ?? '',
    externalAccountId: account.externalAccountId ?? '',
    status: account.status,
    tokenSecretRef: ''
  };
}

const DATA_IMPORTS = [
  {
    title: 'Roster imports',
    body: 'Keep roster import decisions owned in Admin, then hand off to Staff when live.',
    owner: 'Staff'
  },
  {
    title: 'Sales imports',
    body: 'Future Square sales imports will land here before touching Reports or Stock.',
    owner: 'Reports'
  },
  {
    title: 'Invoice imports',
    body: 'Future Xero bill and supplier import setup belongs here, not inside one app.',
    owner: 'Reports'
  },
  {
    title: 'Stock imports',
    body: 'Stock item and supplier import status will sit here while Stock keeps daily work.',
    owner: 'Stock'
  }
];

const APP_DEFAULT_LINKS = [
  {
    title: 'Staff defaults',
    body: 'Default venue, role title, award and Staff app role are still edited in Staff settings today.',
    appId: 'staff',
    href: '/settings'
  },
  {
    title: 'Award and pay defaults',
    body: 'Award default selection is centralised here conceptually, with the working editor still in Staff.',
    appId: 'staff',
    href: '/settings'
  },
  {
    title: 'Leave and onboarding settings',
    body: 'Onboarding steps and leave settings remain in Staff settings until the editor is migrated.',
    appId: 'staff',
    href: '/settings'
  },
  {
    title: 'App-specific setup',
    body: 'Daily app configuration stays close to the app until it is safe to centralise.',
    appId: 'stock',
    href: '/'
  }
];

function toneToBadge(tone: AdminSignalTone) {
  if (tone === 'positive') return 'positive';
  if (tone === 'danger') return 'danger';
  if (tone === 'warning') return 'warning';
  if (tone === 'info') return 'info';
  return 'muted';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, '');
}

function suiteHref(link: Pick<AdminHandoffLink, 'appId' | 'href'>) {
  const base = APP_URLS[link.appId];
  if (!base) return link.href;
  if (/^https?:\/\//i.test(link.href)) return link.href;
  return `${cleanBaseUrl(base)}${link.href.startsWith('/') ? link.href : `/${link.href}`}`;
}

async function openSuiteLink(link: Pick<AdminHandoffLink, 'appId' | 'href'>) {
  const href = suiteHref(link);
  try {
    window.location.href = await createSuiteHandoffUrl(href);
  } catch {
    window.location.href = href;
  }
}

function SectionHeading({
  id,
  eyebrow,
  title,
  description
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div id={id} className="admin-section-heading">
      <p>{eyebrow}</p>
      <h2>{title}</h2>
      <span>{description}</span>
    </div>
  );
}

function StatusLine({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'positive' | 'warning' | 'danger' | 'info' | 'muted' | 'neutral' }) {
  return (
    <div className="admin-status-line">
      <span>{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
}

function integrationTone(status: IntegrationProviderStatus['status']) {
  if (status === 'CONNECTED') return 'positive';
  if (status === 'ERROR') return 'danger';
  if (status === 'NOT_CONFIGURED') return 'warning';
  return 'muted';
}

function IntegrationCard({
  integration,
  busy,
  onConnect,
  onDisconnect
}: {
  integration: IntegrationProviderStatus;
  busy: string | null;
  onConnect: (provider: IntegrationProviderStatus['provider']) => void;
  onDisconnect: (provider: IntegrationProviderStatus['provider']) => void;
}) {
  const isBusy = busy === integration.provider;

  return (
    <Card title={integration.label} subtitle={integration.configured ? 'Connection ready' : 'Setup required'}>
      <div className="admin-provider-card">
        <Badge tone={integrationTone(integration.status)}>{integration.status.replace(/_/g, ' ')}</Badge>
        <p className="muted">Connection tokens are stored securely on the server and are never exposed in the browser.</p>
        <div>
          <strong>Powers</strong>
          <p>{integration.powers.join(', ')}</p>
        </div>
        <div>
          <strong>Account</strong>
          <p>{integration.providerAccountName ?? integration.providerAccountId ?? 'Not connected yet'}</p>
        </div>
        <div>
          <strong>Last sync</strong>
          <p>{integration.lastSyncAt ? formatDate(integration.lastSyncAt) : 'No syncs yet'}</p>
        </div>
        <div>
          <strong>Webhooks</strong>
          <p>{integration.webhookConfigured ? 'Signature key configured' : 'Webhook verification key missing'}</p>
        </div>
        {integration.missingEnvVars.length ? (
          <div>
            <strong>Setup needed</strong>
            <p>{integration.missingEnvVars.join(', ')}</p>
          </div>
        ) : null}
        {integration.lastError ? (
          <div>
            <strong>Last error</strong>
            <p>{integration.lastError}</p>
          </div>
        ) : null}
        <div className="inline-actions">
          <Button
            variant="secondary"
            disabled={integration.actionDisabled || isBusy}
            onClick={() => onConnect(integration.provider)}
          >
            {isBusy ? 'Opening...' : integration.actionLabel}
          </Button>
          {integration.status === 'CONNECTED' ? (
            <Button variant="ghost" disabled={isBusy} onClick={() => onDisconnect(integration.provider)}>
              Disconnect locally
            </Button>
          ) : null}
        </div>
        {integration.connectBlockedReason ? <p className="muted">{integration.connectBlockedReason}</p> : null}
      </div>
    </Card>
  );
}

function socialTone(status: MarketingSocialAccountStatus) {
  if (status === 'CONNECTED') return 'positive';
  if (status === 'ERROR' || status === 'EXPIRED') return 'danger';
  if (status === 'SETUP_REQUIRED') return 'warning';
  return 'muted';
}

function platformSetupCopy(platform: SocialPlatform) {
  if (platform === 'FACEBOOK') return 'Needs a Meta app, Page access, page/account id, and a secret-manager token reference before live publishing.';
  if (platform === 'INSTAGRAM') return 'Needs an Instagram business or creator account connected through Meta plus a secret-manager token reference.';
  return 'Needs a TikTok developer app, OAuth approval, account id, and a secret-manager token reference before live publishing.';
}

function AuditList({ events }: { events: AdminAuditEventSummary[] }) {
  if (!events.length) {
    return (
      <EmptyState
        icon={<IconAudit />}
        title="No audit events yet"
        description="Staff-management audit events will appear here once managers make changes."
      />
    );
  }

  return (
    <div className="admin-audit-list">
      {events.map((event) => (
        <article key={event.id} className="admin-audit-item">
          <div>
            <Badge tone="muted">{event.eventType.replace(/_/g, ' ')}</Badge>
            <h3>{event.summary}</h3>
            <p>
              {event.staffName}
              {event.venue ? ` · ${event.venue}` : ''}
            </p>
          </div>
          <span>{formatDate(event.createdAt)}</span>
        </article>
      ))}
    </div>
  );
}

export function AdminPage() {
  useDocumentTitle('Admin · ALMA Suite');
  const [state, setState] = useState<AdminLoadState>({
    overview: null,
    integrations: null,
    systemHealth: null,
    socialAccounts: []
  });
  const [audit, setAudit] = useState<AdminAuditEventsPayload | null>(null);
  const [auditFilter, setAuditFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [integrationBusy, setIntegrationBusy] = useState<string | null>(null);
  const [socialBusy, setSocialBusy] = useState<string | null>(null);
  const [socialFeedback, setSocialFeedback] = useState<string | null>(null);
  const [socialReadiness, setSocialReadiness] = useState<SocialReadiness | null>(null);
  const [socialForm, setSocialForm] = useState<SocialAccountForm>(() => defaultSocialAccountForm());
  const [editingSocialAccountId, setEditingSocialAccountId] = useState<string | null>(null);
  const [humanAgentReply, setHumanAgentReply] = useState(HUMAN_AGENT_SAMPLE_REPLY);
  const [humanAgentBusy, setHumanAgentBusy] = useState(false);
  const [humanAgentResult, setHumanAgentResult] = useState<HumanAgentDemoResult | null>(null);
  const [humanAgentError, setHumanAgentError] = useState<string | null>(null);

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const [overviewResult, integrationsResult, systemHealthResult, socialAccountsResult] = await Promise.allSettled([
        api<AdminOverviewPayload>('/api/admin/overview'),
        api<AdminIntegrationsStatusPayload>('/api/admin/integrations/status'),
        api<AdminSystemHealthPayload>('/api/admin/system-health'),
        api<MarketingSocialAccount[]>('/api/marketing/content/social-accounts')
      ]);

      if (overviewResult.status === 'rejected') throw overviewResult.reason;
      if (systemHealthResult.status === 'rejected') throw systemHealthResult.reason;

      setState({
        overview: overviewResult.value,
        integrations: integrationsResult.status === 'fulfilled' ? integrationsResult.value : null,
        systemHealth: systemHealthResult.value,
        socialAccounts: socialAccountsResult.status === 'fulfilled' ? socialAccountsResult.value : []
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Admin.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function connectIntegration(provider: IntegrationProviderStatus['provider']) {
    setIntegrationBusy(provider);
    try {
      const payload = await api<IntegrationConnectResponse>(`/api/integrations/${provider}/connect`, {
        method: 'POST'
      });
      window.location.href = payload.authorizationUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start integration connection.');
      setIntegrationBusy(null);
    }
  }

  async function disconnectIntegration(provider: IntegrationProviderStatus['provider']) {
    setIntegrationBusy(provider);
    try {
      await api(`/api/integrations/${provider}/disconnect`, { method: 'POST' });
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect integration.');
    } finally {
      setIntegrationBusy(null);
    }
  }

  async function saveSocialAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSocialBusy('save');
    setSocialFeedback(null);
    try {
      const payload = {
        ...socialForm,
        tokenSecretRef: socialForm.tokenSecretRef.trim() || undefined,
        scopes: [],
        lastError: ''
      };
      await api<MarketingSocialAccount>(
        editingSocialAccountId
          ? `/api/marketing/content/social-accounts/${editingSocialAccountId}`
          : '/api/marketing/content/social-accounts',
        {
          method: editingSocialAccountId ? 'PATCH' : 'POST',
          body: JSON.stringify({
            ...payload,
            ...(editingSocialAccountId && !payload.tokenSecretRef ? { tokenSecretRef: undefined } : {})
          })
        }
      );
      setSocialFeedback(
        editingSocialAccountId
          ? `${socialForm.platform} account updated for ${socialForm.venue}. Existing secret reference was preserved unless you entered a replacement.`
          : `${socialForm.platform} account saved for ${socialForm.venue}. Live publishing remains setup required until OAuth is fully configured.`
      );
      setEditingSocialAccountId(null);
      setSocialForm(defaultSocialAccountForm(socialForm.venue));
      await loadDashboard();
    } catch (err) {
      setSocialFeedback(err instanceof Error ? err.message : 'Could not save social account.');
    } finally {
      setSocialBusy(null);
    }
  }

  function editSocialAccount(account: MarketingSocialAccount) {
    setEditingSocialAccountId(account.id);
    setSocialForm(socialAccountToForm(account));
    setSocialFeedback(
      account.hasTokenSecretRef
        ? 'Editing account metadata. Leave token secret reference blank to keep the existing secret reference.'
        : 'Editing account metadata. Add a token secret reference before live publishing.'
    );
  }

  function cancelSocialAccountEdit() {
    setEditingSocialAccountId(null);
    setSocialForm(defaultSocialAccountForm(socialForm.venue));
    setSocialFeedback(null);
  }

  async function validateSocialAccount(accountId: string) {
    setSocialBusy(accountId);
    setSocialFeedback(null);
    try {
      const result = await api<SocialReadiness>(`/api/marketing/content/social-accounts/${accountId}/validate-readiness`, {
        method: 'POST'
      });
      setSocialReadiness(result);
      setSocialFeedback(`${result.account.platform} readiness checked: ${result.integrationStatus.replace(/_/g, ' ').toLowerCase()}.`);
    } catch (err) {
      setSocialFeedback(err instanceof Error ? err.message : 'Could not validate social account readiness.');
    } finally {
      setSocialBusy(null);
    }
  }

  async function deleteSocialAccount(account: MarketingSocialAccount) {
    const confirmed = window.confirm(
      `Delete ${account.displayName}? This removes the configured social account from Admin. Existing publish history stays in the audit trail.`
    );
    if (!confirmed) return;
    setSocialBusy(account.id);
    setSocialFeedback(null);
    try {
      await api(`/api/marketing/content/social-accounts/${account.id}`, { method: 'DELETE' });
      if (editingSocialAccountId === account.id) cancelSocialAccountEdit();
      if (socialReadiness?.account.id === account.id) setSocialReadiness(null);
      setSocialFeedback(`${account.displayName} was deleted.`);
      await loadDashboard();
    } catch (err) {
      setSocialFeedback(err instanceof Error ? err.message : 'Could not delete social account.');
    } finally {
      setSocialBusy(null);
    }
  }

  async function sendHumanAgentDemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHumanAgentBusy(true);
    setHumanAgentError(null);
    setHumanAgentResult(null);
    try {
      const result = await api<HumanAgentDemoResult>('/api/admin/meta-review-demo/human-agent-reply', {
        method: 'POST',
        body: JSON.stringify({ reply: humanAgentReply })
      });
      setHumanAgentResult(result);
    } catch (err) {
      setHumanAgentError(err instanceof Error ? err.message : 'Could not run the Human Agent demo.');
    } finally {
      setHumanAgentBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadAudit() {
      setAuditLoading(true);
      try {
        const query = auditFilter ? `?eventType=${encodeURIComponent(auditFilter)}` : '';
        const payload = await api<AdminAuditEventsPayload>(`/api/admin/audit-events${query}`);
        if (!cancelled) setAudit(payload);
      } catch {
        if (!cancelled) setAudit({ eventTypes: [], events: [] });
      } finally {
        if (!cancelled) setAuditLoading(false);
      }
    }
    void loadAudit();
    return () => {
      cancelled = true;
    };
  }, [auditFilter]);

  const overview = state.overview;
  const integrations = state.integrations;
  const systemHealth = state.systemHealth;
  const auditOptions = useMemo(
    () => [
      { label: 'All event types', value: '' },
      ...(audit?.eventTypes ?? []).map((eventType) => ({
        label: eventType.replace(/_/g, ' '),
        value: eventType
      }))
    ],
    [audit]
  );
  const venueOptions = useMemo(
    () => overview?.business.venues.map((venue) => ({ label: venue.name, value: venue.name })) ?? [],
    [overview]
  );

  if (loading && !overview) {
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="ALMA Admin"
          title="Suite admin"
          description="Business-wide setup, app configuration, integrations, access, audit and health."
        />
        <Card>
          <div className="admin-loading">
            <Spinner label="Loading Admin..." />
          </div>
        </Card>
      </div>
    );
  }

  if (error || !overview || !systemHealth) {
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="ALMA Admin"
          title="Suite admin"
          description="Business-wide setup, app configuration, integrations, access, audit and health."
        />
        <Card>
          <EmptyState
            icon={<IconSettings />}
            title="Admin could not load"
            description={error ?? 'The Admin API did not return a complete response.'}
            action={<Button onClick={() => void loadDashboard()}>Retry</Button>}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="ALMA Admin"
        title="Suite admin"
        description="Business-wide setup, app configuration, access, integrations, imports, audit and system health. Staff profile actions stay in Staff."
        actions={
          <Button
            variant="secondary"
            leftIcon={<IconRefresh size={14} />}
            onClick={() => void loadDashboard()}
            disabled={loading}
          >
            Refresh
          </Button>
        }
      />

      <nav className="admin-section-nav" aria-label="Admin sections">
        <a href="#overview">Overview</a>
        <a href="#business">Business and venues</a>
        <a href="#access">Users and access</a>
        <a href="#defaults">Apps and defaults</a>
        <a href="#integrations">Integrations</a>
        <a href="#human-agent-demo">Human Agent Demo</a>
        <a href="#imports">Data imports</a>
        <a href="#audit">Audit log</a>
        <a href="#system-health">System health</a>
      </nav>

      <section className="admin-section">
        <SectionHeading
          id="overview"
          eyebrow="Overview"
          title="Is the suite ready to use?"
          description="A small launch-readiness view across the apps that matter most."
        />
        <div className="admin-readiness-card">
          <div>
            <Badge tone={overview.readiness.status === 'ready' ? 'positive' : 'warning'} dot>
              {overview.readiness.status === 'ready' ? 'Ready' : 'Needs attention'}
            </Badge>
            <h2>{overview.readiness.label}</h2>
            <p>
              Generated {formatDate(overview.generatedAt)}. This is a read-only Admin snapshot, not a migration or
              integration run.
            </p>
          </div>
          <Button
            rightIcon={<IconArrowRight size={14} />}
            onClick={() => void openSuiteLink({ appId: 'staff', href: '/settings' })}
          >
            Open Staff settings
          </Button>
        </div>

        <div className="stats-grid">
          <StatCard label="Active staff" value={overview.counts.activeStaff} hint="Current active profiles" icon={<IconStaff />} />
          <StatCard label="Missing staff access" value={overview.counts.staffMissingStaffAccess} hint="Active profiles without Staff app" tone={overview.counts.staffMissingStaffAccess ? 'warning' : 'positive'} icon={<IconUsers />} />
          <StatCard label="Monday roster" value={overview.counts.mondayRosterLoaded ? 'Loaded' : 'Not loaded'} hint={`${overview.counts.mondayRosterShiftCount} shifts`} tone={overview.counts.mondayRosterLoaded ? 'positive' : 'warning'} icon={<IconClock />} />
          <StatCard label="Open clock sessions" value={overview.counts.openClockSessions} hint="Needs manager follow-up if stale" tone={overview.counts.openClockSessions ? 'warning' : 'positive'} icon={<IconTemperature />} />
        </div>

        <div className="admin-grid two">
          <Card title="Key warnings" subtitle="Only real checks from existing suite data">
            {overview.readiness.warnings.length ? (
              <div className="admin-warning-list">
                {overview.readiness.warnings.map((warning) => (
                  <div key={`${warning.label}-${warning.detail}`} className="admin-warning-item">
                    <Badge tone={toneToBadge(warning.tone)} dot>{warning.label}</Badge>
                    <p>{warning.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<IconChecklist />}
                title="No Admin warnings"
                description="No launch-readiness warnings were returned from the current checks."
              />
            )}
          </Card>

          <Card title="App handoff links" subtitle="Open the app that owns the daily workflow">
            <div className="admin-card-list">
              {overview.handoffLinks.map((link) => (
                <button key={`${link.appId}-${link.href}`} className="admin-link-card" type="button" onClick={() => void openSuiteLink(link)}>
                  <span>
                    <strong>{link.label}</strong>
                    <small>{link.description}</small>
                  </span>
                  <IconExternalLink size={16} />
                </button>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <section className="admin-section">
        <SectionHeading
          id="business"
          eyebrow="Business and venues"
          title="The business setup in one place."
          description="Venue setup and trading locations stay visible here, even when the editor still lives elsewhere."
        />
        <div className="admin-grid two">
          <Card title={overview.business.orgName} subtitle="Business details">
            <div className="admin-status-stack">
              <StatusLine label="Primary contact" value={overview.business.primaryContactName || 'Not set'} tone={overview.business.primaryContactName ? 'positive' : 'muted'} />
              <StatusLine label="Contact email" value={overview.business.primaryContactEmail || 'Not set'} tone={overview.business.primaryContactEmail ? 'positive' : 'warning'} />
              <StatusLine label="Contact phone" value={overview.business.primaryContactPhone || 'Not set'} tone={overview.business.primaryContactPhone ? 'positive' : 'muted'} />
            </div>
          </Card>

          <Card title="Trading locations" subtitle="Configured venues and active staff coverage">
            <div className="admin-card-list">
              {overview.business.venues.map((venue) => (
                <div className="admin-mini-card" key={venue.name}>
                  <div>
                    <strong>{venue.name}</strong>
                    <small>{venue.address || 'No address set'}</small>
                  </div>
                  <Badge tone="info">{venue.activeStaffCount} staff</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <section className="admin-section">
        <SectionHeading
          id="access"
          eyebrow="Users and access"
          title="Access is visible. People stay in Staff."
          description="Admin shows the overview, while staff notes, pay, reset links and merge tools remain operational workflows."
        />
        <div className="stats-grid">
          <StatCard label="Admin users" value={overview.counts.adminUsers} hint="Full suite admins" icon={<IconSettings />} />
          <StatCard label="Staff managers" value={overview.counts.staffManagersOrAdmins} hint="Staff app manager/admin roles" icon={<IconUsers />} />
          <StatCard label="Missing email" value={overview.counts.staffMissingLoginEmail} hint="Active profiles" tone={overview.counts.staffMissingLoginEmail ? 'warning' : 'positive'} icon={<IconMail />} />
          <StatCard label="No password hash" value={overview.counts.staffWithoutPassword} hint="Invite or reset needed" tone={overview.counts.staffWithoutPassword ? 'warning' : 'positive'} icon={<IconLicences />} />
        </div>
        <Card title="App access overview" subtitle="Active staff access rows by app">
          <div className="admin-access-grid">
            {overview.appAccess.map((app) => (
              <article key={app.appId} className="admin-access-card">
                <div>
                  <strong>{app.label}</strong>
                  <small>{app.managerOrAdmin} manager/admin</small>
                </div>
                <div className="admin-access-counts">
                  <Badge tone={app.enabled ? 'positive' : 'muted'}>{app.enabled} enabled</Badge>
                  <Badge tone={app.pending ? 'warning' : 'muted'}>{app.pending} pending</Badge>
                  <Badge tone={app.disabled ? 'muted' : 'positive'}>{app.disabled} disabled</Badge>
                </div>
              </article>
            ))}
          </div>
        </Card>
      </section>

      <section className="admin-section">
        <SectionHeading
          id="defaults"
          eyebrow="Apps and defaults"
          title="Defaults have one home."
          description="This is the Admin index for Staff defaults, awards, leave, onboarding and app setup."
        />
        <div className="admin-grid two">
          <Card title="Current staff defaults" subtitle="Read from AppSettings">
            <div className="admin-status-stack">
              <StatusLine label="Award" value={overview.staffDefaults.defaultAwardCode} tone="info" />
              <StatusLine label="Employment type" value={overview.staffDefaults.defaultEmploymentType} tone="info" />
              <StatusLine label="Default role" value={overview.staffDefaults.defaultRoleTitle || 'Not set'} tone={overview.staffDefaults.defaultRoleTitle ? 'positive' : 'muted'} />
              <StatusLine label="Staff app role" value={overview.staffDefaults.defaultStaffAppRole} tone="info" />
            </div>
          </Card>
          <Card title="Managed links" subtitle="No duplicate editors in this pass">
            <div className="admin-card-list">
              {APP_DEFAULT_LINKS.map((link) => (
                <button key={link.title} className="admin-link-card" type="button" onClick={() => void openSuiteLink(link)}>
                  <span>
                    <strong>{link.title}</strong>
                    <small>{link.body}</small>
                  </span>
                  <IconExternalLink size={16} />
                </button>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <section className="admin-section">
        <SectionHeading
          id="integrations"
          eyebrow="Integrations"
          title="Connect the systems that power trading."
          description="Square and Xero can be connected from Admin once server configuration and token encryption are ready."
        />
        <div className="admin-grid three">
          {integrations ? (
            <>
              {[integrations.square, integrations.xero].map((integration) => (
                <IntegrationCard
                  key={integration.provider}
                  integration={integration}
                  busy={integrationBusy}
                  onConnect={(provider) => void connectIntegration(provider)}
                  onDisconnect={(provider) => void disconnectIntegration(provider)}
                />
              ))}
              <Card title="Email and device services" subtitle="Configured without exposing secrets">
                <div className="admin-status-stack">
                  <StatusLine label="Token storage" value={integrations.tokenStorage.configured ? 'CONFIGURED' : 'NOT CONFIGURED'} tone={integrations.tokenStorage.configured ? 'positive' : 'warning'} />
                  <StatusLine label="Email delivery" value={integrations.email.status.replace(/_/g, ' ')} tone={integrations.email.status === 'CONFIGURED' ? 'positive' : 'danger'} />
                  <StatusLine label="Email provider" value={integrations.email.provider} tone={integrations.email.provider === 'none' ? 'muted' : 'info'} />
                  <StatusLine label="Govee status" value={integrations.govee.status.replace(/_/g, ' ')} tone={integrations.govee.status === 'CONFIGURED' ? 'positive' : 'muted'} />
                </div>
              </Card>
            </>
          ) : (
            <Card title="Integration status unavailable" subtitle="Core Admin is still available">
              <EmptyState
                icon={<IconSettings />}
                title="Integration setup is not active yet"
                description="Square and Xero status will appear here after the integration backend is enabled. No connection or sync is running from this screen right now."
              />
            </Card>
          )}
        </div>
        {integrations ? (
          <div className="admin-grid two">
            <Card title="Sync health" subtitle="Last connection and webhook activity">
              {integrations.latestSyncRuns.length ? (
                <div className="admin-status-stack">
                  {integrations.latestSyncRuns.map((run) => (
                    <StatusLine
                      key={run.id}
                      label={`${run.provider.toUpperCase()} ${run.syncType.replace(/_/g, ' ').toLowerCase()}`}
                      value={run.status}
                      tone={run.status === 'SUCCESS' ? 'positive' : run.status === 'ERROR' ? 'danger' : 'info'}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<IconRefresh />}
                  title="No sync activity yet"
                  description="OAuth callbacks, local tests and verified webhook events will appear here once configured."
                />
              )}
            </Card>
          </div>
        ) : null}
        <div className="admin-grid two">
          <Card
            title={editingSocialAccountId ? 'Edit social account' : 'Social publishing setup'}
            subtitle={
              editingSocialAccountId
                ? 'Update platform metadata. Secret references stay hidden and are preserved when left blank.'
                : 'Admin-owned Facebook, Instagram and TikTok readiness'
            }
          >
            <form className="admin-social-form" onSubmit={(event) => void saveSocialAccount(event)}>
              <div className="admin-form-grid">
                <Select
                  label="Venue"
                  value={socialForm.venue}
                  options={venueOptions.length ? venueOptions : [{ label: socialForm.venue, value: socialForm.venue }]}
                  onChange={(event) => setSocialForm((current) => ({ ...current, venue: event.currentTarget.value }))}
                />
                <Select
                  label="Platform"
                  value={socialForm.platform}
                  options={SOCIAL_PLATFORMS.map((platform) => ({ label: platform, value: platform }))}
                  onChange={(event) => setSocialForm((current) => ({ ...current, platform: event.currentTarget.value as SocialPlatform }))}
                />
                <Select
                  label="Status"
                  value={socialForm.status}
                  options={SOCIAL_STATUSES.map((status) => ({ label: status.replace(/_/g, ' '), value: status }))}
                  onChange={(event) => setSocialForm((current) => ({ ...current, status: event.currentTarget.value as MarketingSocialAccountStatus }))}
                />
              </div>
              <div className="admin-form-grid">
                <Input
                  label="Display name"
                  value={socialForm.displayName}
                  onChange={(event) => setSocialForm((current) => ({ ...current, displayName: event.currentTarget.value }))}
                  placeholder="Alma Avalon Facebook"
                  required
                />
                <Input
                  label="Handle"
                  value={socialForm.handle}
                  onChange={(event) => setSocialForm((current) => ({ ...current, handle: event.currentTarget.value }))}
                  placeholder="@almaavalon"
                />
                <Input
                  label="External account id"
                  value={socialForm.externalAccountId}
                  onChange={(event) => setSocialForm((current) => ({ ...current, externalAccountId: event.currentTarget.value }))}
                  placeholder="Page or business account id"
                />
              </div>
              <Input
                label="Token secret reference"
                value={socialForm.tokenSecretRef}
                onChange={(event) => setSocialForm((current) => ({ ...current, tokenSecretRef: event.currentTarget.value }))}
                placeholder="Secret Manager name or env:VARIABLE_NAME"
                hint="Store only a reference here. Never paste an access token into the browser."
              />
              <div className="inline-actions">
                <Button type="submit" disabled={socialBusy === 'save'}>
                  {socialBusy === 'save' ? 'Saving...' : editingSocialAccountId ? 'Update social account' : 'Save social account'}
                </Button>
                {editingSocialAccountId ? (
                  <Button type="button" variant="ghost" onClick={cancelSocialAccountEdit} disabled={socialBusy === 'save'}>
                    Cancel edit
                  </Button>
                ) : null}
                {socialFeedback ? <p className="muted">{socialFeedback}</p> : null}
              </div>
            </form>
          </Card>
          <Card title="Configured social accounts" subtitle="No raw tokens are returned to Admin">
            {state.socialAccounts.length ? (
              <div className="admin-card-list">
                {state.socialAccounts.map((account) => (
                  <article key={account.id} className="admin-mini-card">
                    <div>
                      <strong>{account.displayName}</strong>
                      <small>
                        {account.platform} · {account.venue} · {account.handle ?? 'No handle'}
                      </small>
                      <small>{platformSetupCopy(account.platform)}</small>
                    </div>
                    <div className="admin-social-actions">
                      <Badge tone={socialTone(account.status)}>{account.status.replace(/_/g, ' ')}</Badge>
                      <Badge tone={account.hasTokenSecretRef ? 'positive' : 'warning'}>
                        {account.hasTokenSecretRef ? 'Secret ref' : 'No secret ref'}
                      </Badge>
                      <Button
                        variant="secondary"
                        disabled={socialBusy === account.id}
                        onClick={() => void validateSocialAccount(account.id)}
                      >
                        {socialBusy === account.id ? 'Checking...' : 'Check readiness'}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={socialBusy === account.id}
                        onClick={() => editSocialAccount(account)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={socialBusy === account.id}
                        onClick={() => void deleteSocialAccount(account)}
                      >
                        Delete
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<IconSettings />}
                title="No social accounts configured"
                description="Add Facebook, Instagram or TikTok account metadata here. Live publish stays disabled until the backend flag and token secret are configured."
              />
            )}
          </Card>
          <Card title="Readiness result" subtitle="Connector checks for the selected account">
            {socialReadiness ? (
              <div className="admin-status-stack">
                <StatusLine
                  label={socialReadiness.account.displayName}
                  value={socialReadiness.integrationStatus.replace(/_/g, ' ')}
                  tone={socialReadiness.ready ? 'positive' : 'warning'}
                />
                {socialReadiness.checks.map((check) => (
                  <StatusLine key={check.label} label={check.label} value={check.ok ? 'OK' : check.message} tone={check.ok ? 'positive' : 'warning'} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<IconChecklist />}
                title="Run a readiness check"
                description="Admin will confirm connection status, external account id, secret reference and live connector gating without exposing tokens."
              />
            )}
          </Card>
        </div>
      </section>

      <section className="admin-section">
        <SectionHeading
          id="human-agent-demo"
          eyebrow="Meta Messaging Review"
          title="Human Agent Demo"
          description="A review-safe demonstration of one to one customer support replies outside the standard messaging window."
        />
        <div className="admin-grid two">
          <Card title="Sample customer conversation" subtitle="Demo mode · No real Meta message is sent">
            <div className="admin-human-agent-thread">
              <div className="admin-human-agent-message customer">
                <span>Customer · Facebook/Instagram</span>
                <p>Hi, I think I left my jacket at Alma last night. Can someone please check?</p>
              </div>
              <div className="admin-human-agent-context">
                <Badge tone="warning">Received more than 24 hours ago</Badge>
                <Badge tone="positive">Less than 7 days ago</Badge>
                <Badge tone="info">Requires human staff follow-up</Badge>
              </div>
              <form className="admin-social-form" onSubmit={(event) => void sendHumanAgentDemo(event)}>
                <Textarea
                  label="Staff support reply"
                  rows={5}
                  value={humanAgentReply}
                  onChange={(event) => setHumanAgentReply(event.currentTarget.value)}
                  hint="This demo represents a manually typed or staff-approved one to one customer support response."
                />
                <div className="admin-human-agent-guardrails">
                  <Badge tone="info">Human Agent only</Badge>
                  <Badge tone="info">Support only</Badge>
                  <Badge tone="info">One to one reply</Badge>
                  <Badge tone="info">Within 7 days</Badge>
                  <Badge tone="warning">No marketing</Badge>
                </div>
                <div className="inline-actions">
                  <Button type="submit" disabled={humanAgentBusy}>
                    {humanAgentBusy ? 'Sending demo...' : 'Send Human Agent reply'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setHumanAgentReply(HUMAN_AGENT_SAMPLE_REPLY);
                      setHumanAgentResult(null);
                      setHumanAgentError(null);
                    }}
                  >
                    Reset demo
                  </Button>
                </div>
              </form>
              {humanAgentError ? (
                <div className="admin-warning-item">
                  <Badge tone="danger">Demo error</Badge>
                  <p>{humanAgentError}</p>
                </div>
              ) : null}
              {humanAgentResult ? (
                <div className="admin-human-agent-result">
                  <Badge tone="positive">Demo mode</Badge>
                  <strong>{humanAgentResult.message}</strong>
                  <small>
                    Delivered to Meta: {humanAgentResult.delivered ? 'yes' : 'no'} · Tag: {humanAgentResult.tag} ·{' '}
                    {formatDate(humanAgentResult.simulatedAt)}
                  </small>
                </div>
              ) : null}
            </div>
          </Card>

          <Card title="Reviewer explanation" subtitle="What the screen recording should show">
            <div className="admin-status-stack">
              <p className="admin-card-copy">
                This feature is used only for customer support issues that require human follow-up outside the standard
                messaging window, such as lost property, booking follow-up, complaints, event enquiries, or messages
                received while the venue is closed. It is not used for marketing, promotions, abandoned cart messages, or
                bulk messaging.
              </p>
              <div className="admin-human-agent-steps">
                <strong>Screen recording steps</strong>
                <ol>
                  <li>Open Admin.</li>
                  <li>Open Human Agent Demo.</li>
                  <li>Open the sample customer conversation.</li>
                  <li>Type or review the support reply.</li>
                  <li>Click Send Human Agent reply.</li>
                  <li>Show the demo confirmation.</li>
                </ol>
              </div>
              <div className="admin-status-stack">
                <StatusLine label="Mode" value="DEMO" tone="warning" />
                <StatusLine label="Real Meta delivery" value="OFF" tone="muted" />
                <StatusLine label="Marketing or bulk messaging" value="BLOCKED" tone="positive" />
                <StatusLine label="Human Agent tag" value="WOULD BE APPLIED" tone="info" />
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="admin-section">
        <SectionHeading
          id="imports"
          eyebrow="Data imports"
          title="Imports are named before they are wired."
          description="Admin owns the setup map. The import logic stays in the right app until the integration pass."
        />
        <div className="admin-grid four">
          {DATA_IMPORTS.map((item) => (
            <Card key={item.title} title={item.title} subtitle={item.owner}>
              <p className="admin-card-copy">{item.body}</p>
              <Badge tone="muted">Not checked</Badge>
            </Card>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <SectionHeading
          id="audit"
          eyebrow="Audit log"
          title="Recent management changes."
          description="This uses StaffManagementEvent summaries only. Metadata and sensitive values are not returned."
        />
        <Card
          title="Management audit"
          subtitle="Staff-management events"
          action={
            <Select
              label="Filter"
              value={auditFilter}
              options={auditOptions}
              onChange={(event) => setAuditFilter(event.currentTarget.value)}
            />
          }
        >
          {auditLoading ? (
            <div className="admin-loading"><Spinner label="Loading audit..." /></div>
          ) : (
            <AuditList events={audit?.events ?? []} />
          )}
        </Card>
      </section>

      <section className="admin-section">
        <SectionHeading
          id="system-health"
          eyebrow="System health"
          title="Health without secrets."
          description="Admin reports whether services are configured. It does not expose API keys, reset tokens or provider secrets."
        />
        <div className="admin-grid two">
          <Card title="Core services" subtitle="Current environment">
            <div className="admin-status-stack">
              <StatusLine label="API" value={systemHealth.api.status} tone="positive" />
              <StatusLine label="Database" value={systemHealth.database.status} tone={systemHealth.database.status === 'ok' ? 'positive' : 'danger'} />
              <StatusLine label="Email" value={systemHealth.email.configured ? 'Configured' : 'Not configured'} tone={systemHealth.email.configured ? 'positive' : 'danger'} />
              <StatusLine label="Migration" value={systemHealth.migrations.latest ?? systemHealth.migrations.status.replace(/_/g, ' ')} tone={systemHealth.migrations.status === 'available' ? 'info' : 'muted'} />
            </div>
          </Card>
          <Card title="App URLs" subtitle="Presence check only">
            <div className="admin-url-list">
              {systemHealth.appUrls.map((row) => (
                <div key={row.envVar} className="admin-url-row">
                  <span>
                    <strong>{row.app}</strong>
                    <small>{row.envVar}</small>
                  </span>
                  <Badge tone={row.status === 'configured' ? 'positive' : 'muted'}>{row.status}</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <section className="admin-section">
        <SectionHeading
          id="danger-zone"
          eyebrow="Danger zone"
          title="Nothing global is exposed here yet."
          description="Existing destructive or maintenance actions remain inside their owning app. Admin does not add new dangerous actions in this pass."
        />
        <Card>
          <EmptyState
            icon={<IconInbox />}
            title="No Admin maintenance actions"
            description="This is intentional. The foundation is read-only until the production maintenance model is designed."
          />
        </Card>
      </section>
    </div>
  );
}
