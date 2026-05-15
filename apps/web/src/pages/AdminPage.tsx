import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
  Spinner,
  StatCard
} from '@alma/ui';
import type {
  AdminAuditEventsPayload,
  AdminAuditEventSummary,
  AdminHandoffLink,
  AdminIntegrationsStatusPayload,
  AdminOverviewPayload,
  AdminSignalTone,
  AdminSystemHealthPayload
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
};

const APP_URLS: Record<string, string> = {
  staff: STAFF_WEB_URL,
  stock: STOCK_WEB_URL,
  reports: REPORTS_WEB_URL,
  reserve: RESERVE_WEB_URL,
  marketing: MARKETING_WEB_URL,
  giftcards: GIFTCARDS_WEB_URL
};

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
    systemHealth: null
  });
  const [audit, setAudit] = useState<AdminAuditEventsPayload | null>(null);
  const [auditFilter, setAuditFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const [overview, integrations, systemHealth] = await Promise.all([
        api<AdminOverviewPayload>('/api/admin/overview'),
        api<AdminIntegrationsStatusPayload>('/api/admin/integrations/status'),
        api<AdminSystemHealthPayload>('/api/admin/system-health')
      ]);
      setState({ overview, integrations, systemHealth });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Admin.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

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

  if (error || !overview || !integrations || !systemHealth) {
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
          title="A clean landing place before live connections."
          description="Square and Xero are visible here, but no OAuth, tokens or webhooks are implemented in this pass."
        />
        <div className="admin-grid three">
          {[integrations.square, integrations.xero].map((integration) => (
            <Card key={integration.provider} title={integration.label} subtitle="Integration placeholder">
              <div className="admin-provider-card">
                <Badge tone="muted">{integration.status.replace(/_/g, ' ')}</Badge>
                <div>
                  <strong>Will power</strong>
                  <p>{integration.powers.join(', ')}</p>
                </div>
                <div>
                  <strong>Required setup</strong>
                  <p>{integration.requiredSetup.join(', ')}</p>
                </div>
                <Button variant="secondary" disabled={integration.actionDisabled}>{integration.actionLabel}</Button>
              </div>
            </Card>
          ))}
          <Card title="Email and device services" subtitle="Configured without exposing secrets">
            <div className="admin-status-stack">
              <StatusLine label="Email delivery" value={integrations.email.status.replace(/_/g, ' ')} tone={integrations.email.status === 'CONFIGURED' ? 'positive' : 'danger'} />
              <StatusLine label="Email provider" value={integrations.email.provider} tone={integrations.email.provider === 'none' ? 'muted' : 'info'} />
              <StatusLine label="Govee status" value={integrations.govee.status.replace(/_/g, ' ')} tone={integrations.govee.status === 'CONFIGURED' ? 'positive' : 'muted'} />
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
