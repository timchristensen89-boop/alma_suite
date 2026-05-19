import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
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
  AdminAccessBulkUpdateResult,
  AdminAccessUserSummary,
  AdminAccessUsersPayload,
  AdminAuditEventsPayload,
  AdminAuditEventSummary,
  AdminHandoffLink,
  AdminIntegrationsStatusPayload,
  AdminMetaIntegrationStatus,
  AdminOverviewPayload,
  AdminSignalTone,
  AdminSystemHealthPayload,
  AlmaAppId,
  IntegrationConnectResponse,
  IntegrationProviderStatus,
  MarketingSocialAccount,
  MarketingSocialAccountStatus,
  SocialPlatform,
  StaffAppAccess,
  StaffAppAccessStatus,
  XeroConnectionHealthPayload,
  XeroSupplierBillsImportResult,
  XeroSupplierBillsPreviewPayload,
  XeroSupplierContactsImportResult,
  XeroSupplierContactsPreviewPayload
} from '@alma/shared';
import { api, apiUrl, createSuiteHandoffUrl } from '../lib/api';
import {
  GIFTCARDS_WEB_URL,
  MARKETING_WEB_URL,
  REPORTS_WEB_URL,
  RESERVE_WEB_URL,
  SETTINGS_WEB_URL,
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
  accessUsers: AdminAccessUsersPayload | null;
  integrations: AdminIntegrationsStatusPayload | null;
  systemHealth: AdminSystemHealthPayload | null;
  socialAccounts: MarketingSocialAccount[];
};

export type AdminFeatureRoute =
  | 'all'
  | 'overview'
  | 'settings'
  | 'venues'
  | 'users'
  | 'roles'
  | 'staff-settings'
  | 'staff-record-types'
  | 'staff-onboarding'
  | 'compliance-settings'
  | 'checklist-templates'
  | 'audit-templates'
  | 'integrations'
  | 'xero'
  | 'imports'
  | 'danger-zone'
  | 'human-agent-demo';

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

type AccessRole = 'USER' | 'MANAGER' | 'ADMIN';

const ACCESS_STATUS_OPTIONS: Array<{ label: string; value: StaffAppAccessStatus }> = [
  { label: 'Enabled', value: 'ENABLED' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Disabled', value: 'DISABLED' }
];

const ACCESS_ROLE_OPTIONS: Array<{ label: string; value: AccessRole }> = [
  { label: 'User', value: 'USER' },
  { label: 'Manager', value: 'MANAGER' },
  { label: 'Admin', value: 'ADMIN' }
];

const DEFAULT_ACCESS_PERMISSIONS = {
  view: true,
  create: false,
  edit: false,
  approve: false,
  export: false,
  delete: false,
  admin: false
};

function accessFor(user: AdminAccessUserSummary, appId: AlmaAppId): StaffAppAccess | undefined {
  return user.appAccess.find((access) => access.appId === appId);
}

type CallbackBanner = {
  status: string;
  next: string | null;
  reason: string | null;
} | null;

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
    body: 'Configure roster import decisions in Admin, then hand off to Staff when live.',
    surface: 'Staff'
  },
  {
    title: 'Sales imports',
    body: 'Future Square sales imports will land here before touching Reports or Stock.',
    surface: 'Reports'
  },
  {
    title: 'Invoice imports',
    body: 'Future Xero bill and supplier import setup belongs here, not inside one app.',
    surface: 'Reports'
  },
  {
    title: 'Stock imports',
    body: 'Stock item and supplier import status will sit here while Stock keeps daily work.',
    surface: 'Stock'
  }
];

const ADMIN_SETUP_LINKS = [
  {
    title: 'Staff defaults',
    body: 'Default role, venue, award and Staff app role belong in Admin. The working editor is linked during migration.',
    href: '/admin/staff-settings'
  },
  {
    title: 'Staff onboarding',
    body: 'Required onboarding steps and document upload rules belong in Admin. Staff keeps approvals and reviews.',
    href: '/admin/staff-onboarding'
  },
  {
    title: 'Staff record types',
    body: 'Required certificates, record labels and document rules should be configured in Admin.',
    href: '/admin/staff-record-types'
  },
  {
    title: 'HR document templates',
    body: 'Restricted employment templates belong in Admin. Draft wording must be reviewed before issue.',
    href: '/admin/staff-hr-templates'
  },
  {
    title: 'Compliance settings',
    body: 'Venue compliance setup, required documents and category defaults belong here.',
    href: '/admin/compliance-settings'
  },
  {
    title: 'Checklist templates',
    body: 'Template management belongs in Admin; running checklists stays in Compliance.',
    href: '/admin/checklist-templates'
  },
  {
    title: 'Audit templates',
    body: 'Template management belongs in Admin; completing audits stays in Compliance.',
    href: '/admin/audit-templates'
  },
  {
    title: 'Handbook content',
    body: 'Policy, guideline and handbook content setup belongs in Admin.',
    href: '/admin/handbook'
  }
];

const VENUE_DEVICE_ACCOUNT_PLAN = [
  {
    venue: 'St Alma',
    accountName: 'St Alma shared iPad'
  },
  {
    venue: 'Alma Avalon',
    accountName: 'Alma Avalon shared iPad'
  }
];

const VENUE_DEVICE_ALLOWED_WORKFLOWS = [
  'Gift Cards: redeem/check/print where enabled',
  'Reserve: bookings and availability for assigned venue',
  'Staff: roster view only, no private staff documents',
  'Stock: stock levels and stocktakes for assigned venue',
  'Compliance: checklists, audits, incidents and handbook',
  'Reports: limited venue daily panels only if safe'
];

const VENUE_DEVICE_BLOCKED_WORKFLOWS = [
  'Alma Admin',
  'Xero',
  'Integrations',
  'Users and roles',
  'Payroll exports',
  'Staff documents and private compliance records',
  'All-venue financial reports',
  'Imports and danger zone'
];

const ADMIN_ROUTE_SECTIONS: Record<string, AdminFeatureRoute> = {
  '/': 'overview',
  '/settings': 'settings',
  '/venues': 'venues',
  '/users': 'users',
  '/roles': 'roles',
  '/staff-settings': 'staff-settings',
  '/staff-record-types': 'staff-record-types',
  '/staff-onboarding': 'staff-onboarding',
  '/compliance-settings': 'compliance-settings',
  '/checklist-templates': 'checklist-templates',
  '/audit-templates': 'audit-templates',
  '/handbook': 'compliance-settings',
  '/integrations': 'integrations',
  '/integrations/xero': 'xero',
  '/imports': 'imports',
  '/danger-zone': 'danger-zone',
  '/meta-human-agent-demo': 'human-agent-demo',
  '/admin': 'overview',
  '/admin/venues': 'venues',
  '/admin/users': 'users',
  '/admin/roles': 'roles',
  '/admin/staff-settings': 'staff-settings',
  '/admin/staff-record-types': 'staff-record-types',
  '/admin/staff-onboarding': 'staff-onboarding',
  '/admin/compliance-settings': 'compliance-settings',
  '/admin/checklist-templates': 'checklist-templates',
  '/admin/audit-templates': 'audit-templates',
  '/admin/handbook': 'compliance-settings',
  '/admin/integrations': 'integrations',
  '/admin/integrations/xero': 'xero',
  '/admin/imports': 'imports',
  '/admin/danger-zone': 'danger-zone',
  '/admin/meta-human-agent-demo': 'human-agent-demo'
};

const ADMIN_ROUTE_COPY: Record<AdminFeatureRoute, { title: string; description: string }> = {
  all: {
    title: 'Suite admin',
    description: 'Business-wide setup, app configuration, access, integrations, imports, audit and system health.'
  },
  overview: {
    title: 'Alma Admin',
    description: 'A launchpad for setup, access, integrations, imports and system controls.'
  },
  settings: {
    title: 'General settings',
    description: 'Organisation details, suite health and app configuration entry points.'
  },
  venues: {
    title: 'Venue setup',
    description: 'Trading locations and venue details used across Alma.'
  },
  users: {
    title: 'Users and access',
    description: 'Review who has access to each Alma app.'
  },
  roles: {
    title: 'Roles and permissions',
    description: 'Create users and apply app roles or permission flags.'
  },
  'staff-settings': {
    title: 'Staff settings',
    description: 'Staff defaults and setup links for onboarding and records.'
  },
  'staff-record-types': {
    title: 'Staff record types',
    description: 'Required certificates, document labels and record setup.'
  },
  'staff-onboarding': {
    title: 'Staff onboarding setup',
    description: 'Required onboarding steps and document upload rules.'
  },
  'compliance-settings': {
    title: 'Compliance settings',
    description: 'Compliance setup boundaries and template entry points.'
  },
  'checklist-templates': {
    title: 'Checklist templates',
    description: 'Template setup belongs in Admin; running checklists stays in Compliance.'
  },
  'audit-templates': {
    title: 'Audit templates',
    description: 'Template setup belongs in Admin; completing audits stays in Compliance.'
  },
  integrations: {
    title: 'Integrations',
    description: 'Connection status and setup entry points for external systems.'
  },
  xero: {
    title: 'Xero integration',
    description: 'Health checks, supplier previews, bill previews and selected imports.'
  },
  imports: {
    title: 'Imports',
    description: 'Import lanes are visible here before they are wired into daily apps.'
  },
  'danger-zone': {
    title: 'Danger zone',
    description: 'Restricted controls only. No destructive Admin actions are exposed yet.'
  },
  'human-agent-demo': {
    title: 'Human Agent Demo',
    description: 'Review-safe customer support messaging demo.'
  }
};

const ADMIN_ROUTE_GROUPS = [
  {
    title: 'Business setup',
    links: [
      { label: 'General settings', href: '/settings', description: 'Organisation status, health and app URLs.' },
      { label: 'Venues', href: '/venues', description: 'Trading locations and venue details.' },
      { label: 'Users', href: '/users', description: 'Access overview by app.' },
      { label: 'Roles', href: '/roles', description: 'Create users and apply permissions.' }
    ]
  },
  {
    title: 'Staff and Compliance setup',
    links: [
      { label: 'Staff settings', href: '/staff-settings', description: 'Defaults and Staff setup entry points.' },
      { label: 'Staff record types', href: '/staff-record-types', description: 'Certificates and required document rules.' },
      { label: 'HR templates', href: '/staff-hr-templates', description: 'Restricted HR document template setup.' },
      { label: 'Staff onboarding', href: '/staff-onboarding', description: 'Onboarding setup and upload requirements.' },
      { label: 'Compliance settings', href: '/compliance-settings', description: 'Compliance setup boundaries.' },
      { label: 'Handbook', href: '/handbook', description: 'Edit staff handbook content.' },
      { label: 'Checklist templates', href: '/checklist-templates', description: 'Checklist template management.' },
      { label: 'Audit templates', href: '/audit-templates', description: 'Audit template management.' }
    ]
  },
  {
    title: 'Integrations and controls',
    links: [
      { label: 'Integrations', href: '/integrations', description: 'Connection status and setup entry points.' },
      { label: 'Xero', href: '/integrations/xero', description: 'Xero health, preview and selected import controls.' },
      { label: 'Imports', href: '/imports', description: 'Import lanes before they are wired live.' },
      { label: 'Danger zone', href: '/danger-zone', description: 'Restricted controls and caution copy.' }
    ]
  }
];

function adminPath(path: string, standalone = false) {
  if (!standalone) return path;
  return path.replace(/^\/admin(?=\/|$)/, '') || '/';
}

function adminAppUrl(path = '/') {
  if (!SETTINGS_WEB_URL) return adminPath(path);
  return `${SETTINGS_WEB_URL.replace(/\/+$/, '')}${adminPath(path, true)}`;
}

function adminRouteHref(path: string, standalone = false) {
  return standalone ? adminPath(path, true) : adminAppUrl(path);
}

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

function formatMoney(cents: number, currencyCode = 'AUD') {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: currencyCode
  }).format(cents / 100);
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

function VenueDevicePlanningCard() {
  return (
    <Card
      title="Venue shared iPad accounts"
      subtitle="Readiness plan only. Real accounts, credentials and production users are not created yet."
    >
      <div className="admin-status-stack">
        <div className="admin-access-grid">
          {VENUE_DEVICE_ACCOUNT_PLAN.map((account) => (
            <article key={account.venue} className="admin-access-card">
              <div>
                <strong>{account.accountName}</strong>
                <small>{account.venue}</small>
              </div>
              <Badge tone="warning" dot>Planned</Badge>
              <p className="muted">
                Activate only after per-workflow API route guards enforce this venue-scoped access matrix.
              </p>
            </article>
          ))}
        </div>

        <div className="admin-grid two">
          <div className="admin-provider-card">
            <strong>Allowed planned workflows</strong>
            <ul className="admin-device-policy-list">
              {VENUE_DEVICE_ALLOWED_WORKFLOWS.map((workflow) => (
                <li key={workflow}>{workflow}</li>
              ))}
            </ul>
          </div>
          <div className="admin-provider-card">
            <strong>Blocked workflows</strong>
            <ul className="admin-device-policy-list">
              {VENUE_DEVICE_BLOCKED_WORKFLOWS.map((workflow) => (
                <li key={workflow}>{workflow}</li>
              ))}
            </ul>
          </div>
        </div>

        <p className="muted">
          Current StaffProfile access can label and venue-scope shared devices, but several apps still depend on
          app-level access rather than precise workflow guards. Keep these accounts inactive until route guards are
          tightened.
        </p>
      </div>
    </Card>
  );
}

function integrationTone(status: IntegrationProviderStatus['status']) {
  if (status === 'CONNECTED') return 'positive';
  if (status === 'ERROR') return 'danger';
  if (status === 'NOT_CONFIGURED') return 'warning';
  return 'muted';
}

function xeroHealthTone(status: XeroConnectionHealthPayload['tokenStatus']) {
  if (status === 'healthy' || status === 'refreshed') return 'positive';
  if (status === 'not_connected' || status === 'configuration_missing') return 'muted';
  return 'warning';
}

function metaTone(status: AdminMetaIntegrationStatus['status']) {
  if (status === 'READY_TO_CONNECT') return 'positive';
  if (status === 'CALLBACK_RECEIVED' || status === 'TOKEN_STORAGE_PENDING') return 'info';
  return 'warning';
}

function metaChecklistTone(status: AdminMetaIntegrationStatus['checklist'][number]['status']) {
  if (status === 'done') return 'positive';
  if (status === 'not_configured') return 'muted';
  return 'warning';
}

function currentCallbackBanner(): CallbackBanner {
  const params = new URLSearchParams(window.location.search);
  if (params.get('integration') !== 'meta') return null;
  return {
    status: params.get('status') ?? 'unknown',
    next: params.get('next'),
    reason: params.get('reason')
  };
}

function IntegrationCard({
  integration,
  busy,
  onConnect,
  onDisconnect,
  onHealthCheck,
  xeroHealth
}: {
  integration: IntegrationProviderStatus;
  busy: string | null;
  onConnect: (provider: IntegrationProviderStatus['provider']) => void;
  onDisconnect: (provider: IntegrationProviderStatus['provider']) => void;
  onHealthCheck?: () => void;
  xeroHealth?: XeroConnectionHealthPayload | null;
}) {
  const isBusy = busy === integration.provider;
  const isHealthBusy = busy === 'xero-health';
  const isXero = integration.provider === 'xero';

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
        {isXero ? (
          <div>
            <strong>Accounting sync</strong>
            <p>No contacts, bills, invoices, payroll or reports are syncing yet. This connection is being prepared for read-only supplier and bill checks.</p>
          </div>
        ) : null}
        <div>
          <strong>Webhooks</strong>
          <p>{integration.webhookConfigured ? 'Signature key configured' : 'Webhook verification key missing'}</p>
        </div>
        {isXero && xeroHealth ? (
          <div className="admin-status-stack">
            <StatusLine label="Health check" value={xeroHealth.tokenStatus.replace(/_/g, ' ')} tone={xeroHealthTone(xeroHealth.tokenStatus)} />
            <StatusLine label="Tenant" value={xeroHealth.tenantName ?? xeroHealth.tenantStatus.replace(/_/g, ' ')} tone={xeroHealth.tenantStatus === 'reachable' ? 'positive' : 'warning'} />
            <StatusLine label="Tenant count" value={xeroHealth.tenantCount === null ? 'Not checked' : String(xeroHealth.tenantCount)} tone={xeroHealth.tenantSelectionRequired ? 'warning' : 'muted'} />
            <p className="muted">{xeroHealth.message}</p>
          </div>
        ) : null}
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
          {isXero && onHealthCheck ? (
            <Button variant="secondary" disabled={isHealthBusy} onClick={onHealthCheck}>
              {isHealthBusy ? 'Checking...' : 'Check Xero health'}
            </Button>
          ) : null}
        </div>
        {integration.connectBlockedReason ? <p className="muted">{integration.connectBlockedReason}</p> : null}
      </div>
    </Card>
  );
}

function XeroSyncPanel({
  contactPreview,
  billPreview,
  selectedContacts,
  selectedBills,
  busy,
  feedback,
  allowCreateSuppliers,
  onPreviewContacts,
  onToggleContact,
  onImportContacts,
  onPreviewBills,
  onToggleBill,
  onImportBills,
  onAllowCreateSuppliersChange
}: {
  contactPreview: XeroSupplierContactsPreviewPayload | null;
  billPreview: XeroSupplierBillsPreviewPayload | null;
  selectedContacts: string[];
  selectedBills: string[];
  busy: string | null;
  feedback: string | null;
  allowCreateSuppliers: boolean;
  onPreviewContacts: () => void;
  onToggleContact: (id: string) => void;
  onImportContacts: () => void;
  onPreviewBills: () => void;
  onToggleBill: (id: string) => void;
  onImportBills: () => void;
  onAllowCreateSuppliersChange: (enabled: boolean) => void;
}) {
  return (
    <Card title="Xero supplier and bill import" subtitle="Preview first, then import selected records">
      <div className="admin-status-stack">
        <p className="muted">
          No accounting data sync is running automatically yet. Preview Xero records before importing. Payroll,
          payments and bank feeds are not connected.
        </p>
        {feedback ? <Badge tone="info">{feedback}</Badge> : null}
        <div className="admin-grid two">
          <div className="admin-provider-card">
            <div>
              <strong>Supplier contacts</strong>
              <p>Review Xero contacts that are marked as suppliers, then create or update selected Alma suppliers.</p>
            </div>
            <div className="inline-actions">
              <Button variant="secondary" disabled={Boolean(busy)} onClick={onPreviewContacts}>
                {busy === 'xero-contacts-preview' ? 'Loading...' : 'Preview contacts'}
              </Button>
              <Button variant="primary" disabled={Boolean(busy) || !selectedContacts.length} onClick={onImportContacts}>
                {busy === 'xero-contacts-import' ? 'Importing...' : `Import selected (${selectedContacts.length})`}
              </Button>
            </div>
            {contactPreview ? (
              <div className="admin-status-stack">
                <StatusLine label="Contacts read" value={String(contactPreview.contactsRead)} tone="muted" />
                <StatusLine label="Supplier candidates" value={String(contactPreview.supplierCandidates)} tone="info" />
                <StatusLine label="Matched suppliers" value={String(contactPreview.matchedSuppliers)} tone={contactPreview.matchedSuppliers ? 'positive' : 'muted'} />
                {contactPreview.contacts.slice(0, 8).map((contact) => (
                  <label key={contact.xeroContactId} className="admin-checkbox-row">
                    <input
                      type="checkbox"
                      checked={selectedContacts.includes(contact.xeroContactId)}
                      onChange={() => onToggleContact(contact.xeroContactId)}
                    />
                    <span>
                      <strong>{contact.name}</strong>
                      <small>
                        {contact.existingSupplierMatch
                          ? `Matched to ${contact.existingSupplierName}`
                          : contact.isSupplierCandidate
                            ? 'Supplier candidate'
                            : 'Not marked as supplier'}
                      </small>
                    </span>
                  </label>
                ))}
                {contactPreview.contacts.length > 8 ? <p className="muted">Showing first 8 preview rows.</p> : null}
                {contactPreview.warnings.map((warning) => <p key={warning} className="muted">{warning}</p>)}
              </div>
            ) : null}
          </div>

          <div className="admin-provider-card">
            <div>
              <strong>Supplier bills</strong>
              <p>Preview recent Xero ACCPAY bills, match suppliers, then import selected bills into Stock invoices.</p>
            </div>
            <div className="inline-actions">
              <Button variant="secondary" disabled={Boolean(busy)} onClick={onPreviewBills}>
                {busy === 'xero-bills-preview' ? 'Loading...' : 'Preview bills'}
              </Button>
              <Button variant="primary" disabled={Boolean(busy) || !selectedBills.length} onClick={onImportBills}>
                {busy === 'xero-bills-import' ? 'Importing...' : `Import selected (${selectedBills.length})`}
              </Button>
            </div>
            <label className="admin-checkbox-row">
              <input
                type="checkbox"
                checked={allowCreateSuppliers}
                onChange={(event) => onAllowCreateSuppliersChange(event.currentTarget.checked)}
              />
              <span>
                <strong>Create missing suppliers during bill import</strong>
                <small>Leave off when suppliers should be reviewed before bills are imported.</small>
              </span>
            </label>
            {billPreview ? (
              <div className="admin-status-stack">
                <StatusLine label="Bills previewed" value={String(billPreview.billsPreviewed)} tone="info" />
                <StatusLine label="Date range" value={`${billPreview.startDate} to ${billPreview.endDate}`} tone="muted" />
                {Object.entries(billPreview.statusCounts).map(([status, count]) => (
                  <StatusLine key={status} label={status} value={String(count)} tone="muted" />
                ))}
                {billPreview.bills.slice(0, 8).map((bill) => (
                  <label key={bill.xeroInvoiceId} className="admin-checkbox-row">
                    <input
                      type="checkbox"
                      checked={selectedBills.includes(bill.xeroInvoiceId)}
                      disabled={bill.duplicateStatus === 'duplicate'}
                      onChange={() => onToggleBill(bill.xeroInvoiceId)}
                    />
                    <span>
                      <strong>{bill.supplierName}</strong>
                      <small>
                        {(bill.invoiceNumber ?? bill.reference ?? 'No reference')} · {bill.status} · {formatMoney(bill.totalCents, bill.currencyCode)} · {bill.supplierMatchStatus}
                        {bill.duplicateStatus !== 'new' ? ` · ${bill.duplicateStatus.replace(/_/g, ' ')}` : ''}
                      </small>
                    </span>
                  </label>
                ))}
                {billPreview.bills.length > 8 ? <p className="muted">Showing first 8 preview rows.</p> : null}
                {billPreview.warnings.map((warning) => <p key={warning} className="muted">{warning}</p>)}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}

function MetaIntegrationCard({
  meta,
  busy,
  callbackBanner,
  onConnect
}: {
  meta: AdminMetaIntegrationStatus;
  busy: string | null;
  callbackBanner: CallbackBanner;
  onConnect: () => void;
}) {
  const isBusy = busy === 'meta';
  const displayStatus: AdminMetaIntegrationStatus['status'] =
    callbackBanner?.next === 'store_token_secret_reference'
      ? 'TOKEN_STORAGE_PENDING'
      : callbackBanner?.status === 'callback_received'
        ? 'CALLBACK_RECEIVED'
        : meta.status;

  return (
    <Card title={meta.label} subtitle="Business Login for Facebook and Instagram">
      <div className="admin-provider-card">
        <Badge tone={metaTone(displayStatus)}>{displayStatus.replace(/_/g, ' ')}</Badge>
        {callbackBanner ? (
          <div className="admin-warning-item">
            <Badge tone={callbackBanner.status === 'callback_received' ? 'positive' : 'warning'}>
              {callbackBanner.status.replace(/_/g, ' ')}
            </Badge>
            <p>
              {callbackBanner.next === 'store_token_secret_reference'
                ? 'Meta returned an OAuth code. Token exchange/storage is intentionally pending; store only a Secret Manager token reference before live publishing.'
                : callbackBanner.reason ?? 'Meta callback returned to Admin.'}
            </p>
          </div>
        ) : null}
        <div>
          <strong>Redirect URI</strong>
          <p>{meta.redirectUri}</p>
        </div>
        <div>
          <strong>Allowed domains</strong>
          <p>{meta.allowedDomains.join(', ')}</p>
        </div>
        <div>
          <strong>Review scopes</strong>
          <p>{meta.scopes.join(', ')}</p>
        </div>
        {meta.missingEnvVars.length ? (
          <div>
            <strong>Setup needed</strong>
            <p>{meta.missingEnvVars.join(', ')}</p>
          </div>
        ) : null}
        <div className="admin-status-stack">
          {meta.checklist.map((item) => (
            <StatusLine
              key={item.label}
              label={item.label}
              value={item.detail}
              tone={metaChecklistTone(item.status)}
            />
          ))}
        </div>
        <div className="inline-actions">
          <Button variant="secondary" disabled={!meta.canConnect || isBusy} onClick={onConnect}>
            {isBusy ? 'Opening Meta...' : 'Connect Meta'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => { window.location.href = adminAppUrl('/meta-human-agent-demo'); }}>
            Review demo
          </Button>
        </div>
        {meta.connectBlockedReason ? <p className="muted">{meta.connectBlockedReason}</p> : null}
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

export function AdminPage({
  standalone = false,
  route
}: {
  standalone?: boolean;
  route?: AdminFeatureRoute;
}) {
  const location = useLocation();
  const activeRoute = route ?? ADMIN_ROUTE_SECTIONS[location.pathname] ?? (standalone ? 'overview' : 'all');
  const routeCopy = ADMIN_ROUTE_COPY[activeRoute];
  useDocumentTitle(`${routeCopy.title} · Alma Admin`);
  const [state, setState] = useState<AdminLoadState>({
    overview: null,
    accessUsers: null,
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
  const [xeroHealth, setXeroHealth] = useState<XeroConnectionHealthPayload | null>(null);
  const [xeroContactPreview, setXeroContactPreview] = useState<XeroSupplierContactsPreviewPayload | null>(null);
  const [xeroBillPreview, setXeroBillPreview] = useState<XeroSupplierBillsPreviewPayload | null>(null);
  const [xeroSelectedContacts, setXeroSelectedContacts] = useState<string[]>([]);
  const [xeroSelectedBills, setXeroSelectedBills] = useState<string[]>([]);
  const [xeroSyncBusy, setXeroSyncBusy] = useState<string | null>(null);
  const [xeroSyncFeedback, setXeroSyncFeedback] = useState<string | null>(null);
  const [xeroAllowCreateSuppliers, setXeroAllowCreateSuppliers] = useState(false);
  const [callbackBanner] = useState<CallbackBanner>(() => currentCallbackBanner());
  const [socialBusy, setSocialBusy] = useState<string | null>(null);
  const [socialFeedback, setSocialFeedback] = useState<string | null>(null);
  const [socialReadiness, setSocialReadiness] = useState<SocialReadiness | null>(null);
  const [socialForm, setSocialForm] = useState<SocialAccountForm>(() => defaultSocialAccountForm());
  const [editingSocialAccountId, setEditingSocialAccountId] = useState<string | null>(null);
  const [humanAgentReply, setHumanAgentReply] = useState(HUMAN_AGENT_SAMPLE_REPLY);
  const [humanAgentBusy, setHumanAgentBusy] = useState(false);
  const [humanAgentResult, setHumanAgentResult] = useState<HumanAgentDemoResult | null>(null);
  const [humanAgentError, setHumanAgentError] = useState<string | null>(null);
  const [accessSearch, setAccessSearch] = useState('');
  const [accessVenueFilter, setAccessVenueFilter] = useState('');
  const [selectedAccessUsers, setSelectedAccessUsers] = useState<string[]>([]);
  const [bulkAccessApps, setBulkAccessApps] = useState<AlmaAppId[]>(['STAFF']);
  const [bulkAccessStatus, setBulkAccessStatus] = useState<StaffAppAccessStatus>('ENABLED');
  const [bulkAccessRole, setBulkAccessRole] = useState<AccessRole>('USER');
  const [bulkPermissionMode, setBulkPermissionMode] = useState<'MERGE' | 'REPLACE'>('MERGE');
  const [bulkPermissions, setBulkPermissions] = useState<Record<string, boolean>>(DEFAULT_ACCESS_PERMISSIONS);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessFeedback, setAccessFeedback] = useState<string | null>(null);
  const [newUserForm, setNewUserForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    venue: '',
    roleTitle: '',
    staffRole: 'USER' as AccessRole,
    enableStaffApp: true
  });

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const [overviewResult, accessUsersResult, integrationsResult, systemHealthResult, socialAccountsResult] = await Promise.allSettled([
        api<AdminOverviewPayload>('/api/admin/overview'),
        api<AdminAccessUsersPayload>('/api/admin/access/users'),
        api<AdminIntegrationsStatusPayload>('/api/admin/integrations/status'),
        api<AdminSystemHealthPayload>('/api/admin/system-health'),
        api<MarketingSocialAccount[]>('/api/marketing/content/social-accounts')
      ]);

      if (overviewResult.status === 'rejected') throw overviewResult.reason;
      if (systemHealthResult.status === 'rejected') throw systemHealthResult.reason;

      setState({
        overview: overviewResult.value,
        accessUsers: accessUsersResult.status === 'fulfilled' ? accessUsersResult.value : null,
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

  useEffect(() => {
    const sectionId = ADMIN_ROUTE_SECTIONS[location.pathname] ?? (standalone ? ADMIN_ROUTE_SECTIONS[`/admin${location.pathname}`] : undefined);
    if (!sectionId) return;
    window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ block: 'start' });
    });
  }, [location.pathname]);

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

  function connectMeta() {
    setIntegrationBusy('meta');
    window.location.assign(apiUrl('/api/integrations/meta/connect'));
  }

  async function disconnectIntegration(provider: IntegrationProviderStatus['provider']) {
    setIntegrationBusy(provider);
    try {
      await api(`/api/integrations/${provider}/disconnect`, { method: 'POST' });
      if (provider === 'xero') setXeroHealth(null);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect integration.');
    } finally {
      setIntegrationBusy(null);
    }
  }

  async function checkXeroHealth() {
    setIntegrationBusy('xero-health');
    setError(null);
    try {
      const payload = await api<XeroConnectionHealthPayload>('/api/integrations/xero/health-check', {
        method: 'POST'
      });
      setXeroHealth(payload);
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check Xero health.');
    } finally {
      setIntegrationBusy(null);
    }
  }

  function toggleXeroContact(id: string) {
    setXeroSelectedContacts((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );
  }

  function toggleXeroBill(id: string) {
    setXeroSelectedBills((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );
  }

  async function previewXeroSupplierContacts() {
    setXeroSyncBusy('xero-contacts-preview');
    setXeroSyncFeedback(null);
    setError(null);
    try {
      const payload = await api<XeroSupplierContactsPreviewPayload>('/api/integrations/xero/supplier-contacts/preview?limit=100');
      setXeroContactPreview(payload);
      setXeroSelectedContacts([]);
      setXeroSyncFeedback(`Previewed ${payload.contacts.length} Xero contacts. Nothing was imported.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not preview Xero supplier contacts.');
    } finally {
      setXeroSyncBusy(null);
    }
  }

  async function importXeroSupplierContacts() {
    if (!xeroSelectedContacts.length) return;
    setXeroSyncBusy('xero-contacts-import');
    setXeroSyncFeedback(null);
    setError(null);
    try {
      const result = await api<XeroSupplierContactsImportResult>('/api/integrations/xero/supplier-contacts/import', {
        method: 'POST',
        body: JSON.stringify({ contactIds: xeroSelectedContacts, limit: 500 })
      });
      setXeroSelectedContacts([]);
      setXeroSyncFeedback(
        `Supplier import finished: ${result.createdCount} created, ${result.updatedCount} updated, ${result.skippedCount} skipped.`
      );
      await previewXeroSupplierContacts();
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import selected Xero supplier contacts.');
    } finally {
      setXeroSyncBusy(null);
    }
  }

  async function previewXeroSupplierBills() {
    setXeroSyncBusy('xero-bills-preview');
    setXeroSyncFeedback(null);
    setError(null);
    try {
      const payload = await api<XeroSupplierBillsPreviewPayload>('/api/integrations/xero/supplier-bills/preview?limit=30');
      setXeroBillPreview(payload);
      setXeroSelectedBills([]);
      setXeroSyncFeedback(`Previewed ${payload.billsPreviewed} Xero bills. Nothing was imported.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not preview Xero supplier bills.');
    } finally {
      setXeroSyncBusy(null);
    }
  }

  async function importXeroSupplierBills() {
    if (!xeroSelectedBills.length) return;
    setXeroSyncBusy('xero-bills-import');
    setXeroSyncFeedback(null);
    setError(null);
    try {
      const result = await api<XeroSupplierBillsImportResult>('/api/integrations/xero/supplier-bills/import', {
        method: 'POST',
        body: JSON.stringify({
          billIds: xeroSelectedBills,
          allowCreateSuppliers: xeroAllowCreateSuppliers,
          confirmationText: 'IMPORT XERO BILLS',
          limit: 100
        })
      });
      setXeroSelectedBills([]);
      setXeroSyncFeedback(
        `Bill import finished: ${result.importedCount} imported, ${result.duplicateCount} duplicates, ${result.skippedCount} skipped.`
      );
      await previewXeroSupplierBills();
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import selected Xero supplier bills.');
    } finally {
      setXeroSyncBusy(null);
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

  function toggleSelectedAccessUser(id: string) {
    setSelectedAccessUsers((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  function toggleBulkAccessApp(appId: AlmaAppId) {
    setBulkAccessApps((current) =>
      current.includes(appId) ? current.filter((item) => item !== appId) : [...current, appId]
    );
  }

  async function createAccessUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccessBusy(true);
    setAccessFeedback(null);
    try {
      await api('/api/admin/access/users', {
        method: 'POST',
        body: JSON.stringify(newUserForm)
      });
      setNewUserForm({
        firstName: '',
        lastName: '',
        email: '',
        venue: newUserForm.venue,
        roleTitle: '',
        staffRole: 'USER',
        enableStaffApp: true
      });
      setAccessFeedback('New user created. Send a setup email from Staff when they are ready to log in.');
      await loadDashboard();
    } catch (err) {
      setAccessFeedback(err instanceof Error ? err.message : 'Could not create user.');
    } finally {
      setAccessBusy(false);
    }
  }

  async function applyBulkAccessUpdate() {
    if (!selectedAccessUsers.length || !bulkAccessApps.length) return;
    const confirmAdmin =
      bulkAccessRole === 'ADMIN' || bulkPermissions.admin || bulkAccessApps.includes('SETTINGS');
    if (confirmAdmin) {
      const confirmed = window.confirm(
        'This bulk update touches Admin or Settings-level access. Continue only if these users should have that access.'
      );
      if (!confirmed) return;
    }
    setAccessBusy(true);
    setAccessFeedback(null);
    try {
      const result = await api<AdminAccessBulkUpdateResult>('/api/admin/access/bulk-update', {
        method: 'POST',
        body: JSON.stringify({
          staffProfileIds: selectedAccessUsers,
          appIds: bulkAccessApps,
          status: bulkAccessStatus,
          role: bulkAccessRole,
          permissions: bulkPermissions,
          permissionMode: bulkPermissionMode
        })
      });
      setAccessFeedback(`Updated ${result.updatedRows} app access rows across ${result.updatedUsers} users.`);
      setSelectedAccessUsers([]);
      await loadDashboard();
    } catch (err) {
      setAccessFeedback(err instanceof Error ? err.message : 'Could not bulk update access.');
    } finally {
      setAccessBusy(false);
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
  const accessUsers = state.accessUsers;
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
  const accessVenueOptions = useMemo(
    () => [
      { label: 'All venues', value: '' },
      ...Array.from(new Set((accessUsers?.users ?? []).map((user) => user.venue || 'Unassigned')))
        .sort()
        .map((venue) => ({ label: venue, value: venue }))
    ],
    [accessUsers]
  );
  const filteredAccessUsers = useMemo(() => {
    const query = accessSearch.trim().toLowerCase();
    return (accessUsers?.users ?? []).filter((user) => {
      const venue = user.venue || 'Unassigned';
      if (accessVenueFilter && venue !== accessVenueFilter) return false;
      if (!query) return true;
      return [
        user.firstName,
        user.lastName,
        user.email ?? '',
        user.roleTitle,
        user.venue ?? ''
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [accessSearch, accessUsers, accessVenueFilter]);
  const allVisibleAccessUsersSelected =
    filteredAccessUsers.length > 0 && filteredAccessUsers.every((user) => selectedAccessUsers.includes(user.id));
  const isAll = activeRoute === 'all';
  const isOverview = activeRoute === 'overview';
  const showSettings = isAll || activeRoute === 'settings';
  const showVenues = isAll || activeRoute === 'venues';
  const showUsers = isAll || activeRoute === 'users';
  const showRoles = isAll || activeRoute === 'roles';
  const showStaffSettings = isAll || activeRoute === 'staff-settings';
  const showStaffRecordTypes = isAll || activeRoute === 'staff-record-types';
  const showStaffOnboarding = isAll || activeRoute === 'staff-onboarding';
  const showComplianceSettings = isAll || activeRoute === 'compliance-settings';
  const showChecklistTemplates = isAll || activeRoute === 'checklist-templates';
  const showAuditTemplates = isAll || activeRoute === 'audit-templates';
  const showIntegrations = isAll || activeRoute === 'integrations';
  const showXero = isAll || activeRoute === 'xero';
  const showImports = isAll || activeRoute === 'imports';
  const showDangerZone = isAll || activeRoute === 'danger-zone';
  const showHumanAgentDemo = isAll || activeRoute === 'human-agent-demo';
  const showAudit = isAll || showSettings;
  const showSystemHealth = isAll || showSettings;
  const showRouteNav = !standalone || isAll;

  if (loading && !overview) {
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="ALMA Admin"
          title={routeCopy.title}
          description={routeCopy.description}
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
          title={routeCopy.title}
          description={routeCopy.description}
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
        title={routeCopy.title}
        description={routeCopy.description}
        actions={
          <div className="inline-actions">
            {standalone && !isOverview ? (
              <Button type="button" variant="ghost" onClick={() => { window.location.href = '/'; }}>
                Admin overview
              </Button>
            ) : null}
            <Button
              variant="secondary"
              leftIcon={<IconRefresh size={14} />}
              onClick={() => void loadDashboard()}
              disabled={loading}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {!standalone && SETTINGS_WEB_URL ? (
        <Card
          title="Alma Admin has its own app"
          subtitle="Setup and configuration now live in Alma Admin. This Compliance route remains available during the transition."
          action={
            <Button type="button" variant="secondary" onClick={() => { window.location.href = adminAppUrl('/'); }}>
              Open Alma Admin
            </Button>
          }
        />
      ) : null}

      {showRouteNav ? (
      <nav className="admin-section-nav" aria-label="Admin sections">
        <a href="#overview">Overview</a>
        <a href="#business">Business and venues</a>
        <a href="#access">Users and access</a>
        <a href="#permission-editor">Permission editor</a>
        <a href="#defaults">Apps and defaults</a>
        <a href="#compliance-settings">Compliance setup</a>
        <a href="#integrations">Integrations</a>
        <a href="#human-agent-demo">Human Agent Demo</a>
        <a href="#imports">Data imports</a>
        <a href="#audit">Audit log</a>
        <a href="#system-health">System health</a>
      </nav>
      ) : null}

      {(isAll || isOverview) ? (
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

          <Card title="App handoff links" subtitle="Open the app for each daily workflow">
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
        <div className="admin-grid three">
          {ADMIN_ROUTE_GROUPS.map((group) => (
            <Card key={group.title} title={group.title} subtitle="Open the page for that workflow">
              <div className="admin-card-list">
                {group.links.map((link) => (
                  <a key={link.href} className="admin-link-card" href={adminRouteHref(link.href, standalone)}>
                    <span>
                      <strong>{link.label}</strong>
                      <small>{link.description}</small>
                    </span>
                    <IconArrowRight size={16} />
                  </a>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>
      ) : null}

      {(showSettings || showVenues) ? (
      <section className="admin-section">
        <SectionHeading
          id="business"
          eyebrow={showSettings && !showVenues ? 'General settings' : 'Venue setup'}
          title={showSettings && !showVenues ? 'Business details and suite status.' : 'Trading locations.'}
          description={showSettings && !showVenues ? 'General settings stay in Admin, with daily work left in each app.' : 'Venue setup and trading locations stay visible here.'}
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
        {showVenues ? <VenueDevicePlanningCard /> : null}
      </section>
      ) : null}

      {showUsers ? (
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
      ) : null}

      {showRoles ? (
      <section className="admin-section">
        <SectionHeading
          id="permission-editor"
          eyebrow="Permission editor"
          title="Update user access in one place."
          description="Create users, select staff in bulk, and apply app roles or permission flags without opening each profile."
        />

        {!accessUsers ? (
          <Card>
            <EmptyState
              icon={<IconUsers />}
              title="Access editor unavailable"
              description="The Admin access endpoint did not return data. The read-only overview above is still available."
            />
          </Card>
        ) : (
          <>
            <div className="admin-grid two">
              <Card title="Add a user" subtitle="Creates a Staff profile and optional Staff app access">
                <form className="admin-social-form" onSubmit={(event) => void createAccessUser(event)}>
                  <div className="admin-form-grid">
                    <Input
                      label="First name"
                      value={newUserForm.firstName}
                      onChange={(event) => setNewUserForm((form) => ({ ...form, firstName: event.target.value }))}
                      required
                    />
                    <Input
                      label="Last name"
                      value={newUserForm.lastName}
                      onChange={(event) => setNewUserForm((form) => ({ ...form, lastName: event.target.value }))}
                      required
                    />
                    <Input
                      label="Email"
                      type="email"
                      value={newUserForm.email}
                      onChange={(event) => setNewUserForm((form) => ({ ...form, email: event.target.value }))}
                    />
                  </div>
                  <div className="admin-form-grid">
                    <Select
                      label="Venue"
                      value={newUserForm.venue}
                      onChange={(event) => setNewUserForm((form) => ({ ...form, venue: event.target.value }))}
                      options={[{ label: 'No venue yet', value: '' }, ...venueOptions]}
                    />
                    <Input
                      label="Role title"
                      value={newUserForm.roleTitle}
                      onChange={(event) => setNewUserForm((form) => ({ ...form, roleTitle: event.target.value }))}
                      placeholder="Team member"
                    />
                    <Select
                      label="Staff app role"
                      value={newUserForm.staffRole}
                      onChange={(event) => setNewUserForm((form) => ({ ...form, staffRole: event.target.value as AccessRole }))}
                      options={ACCESS_ROLE_OPTIONS}
                    />
                  </div>
                  <label className="admin-checkbox">
                    <input
                      type="checkbox"
                      checked={newUserForm.enableStaffApp}
                      onChange={(event) => setNewUserForm((form) => ({ ...form, enableStaffApp: event.target.checked }))}
                    />
                    <span>Enable Staff app access immediately</span>
                  </label>
                  <div className="toolbar-right">
                    <Button type="submit" disabled={accessBusy || !newUserForm.firstName.trim() || !newUserForm.lastName.trim()}>
                      {accessBusy ? 'Saving...' : 'Add user'}
                    </Button>
                  </div>
                </form>
              </Card>

              <Card
                title="Bulk access update"
                subtitle={`${selectedAccessUsers.length} selected user${selectedAccessUsers.length === 1 ? '' : 's'}`}
              >
                <div className="admin-access-bulk-panel">
                  <div>
                    <strong>Apps to update</strong>
                    <div className="admin-chip-grid">
                      {accessUsers.apps.map((app) => (
                        <label key={app.appId} className="admin-check-chip">
                          <input
                            type="checkbox"
                            checked={bulkAccessApps.includes(app.appId)}
                            onChange={() => toggleBulkAccessApp(app.appId)}
                          />
                          <span>{app.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="admin-form-grid">
                    <Select
                      label="Status"
                      value={bulkAccessStatus}
                      onChange={(event) => setBulkAccessStatus(event.target.value as StaffAppAccessStatus)}
                      options={ACCESS_STATUS_OPTIONS}
                    />
                    <Select
                      label="Role"
                      value={bulkAccessRole}
                      onChange={(event) => setBulkAccessRole(event.target.value as AccessRole)}
                      options={ACCESS_ROLE_OPTIONS}
                    />
                    <Select
                      label="Permission mode"
                      value={bulkPermissionMode}
                      onChange={(event) => setBulkPermissionMode(event.target.value as 'MERGE' | 'REPLACE')}
                      options={[
                        { label: 'Merge with existing', value: 'MERGE' },
                        { label: 'Replace app permissions', value: 'REPLACE' }
                      ]}
                    />
                  </div>
                  <div>
                    <strong>Permission flags</strong>
                    <div className="admin-permission-grid">
                      {accessUsers.permissionKeys.map((permission) => (
                        <label
                          key={permission.key}
                          className={`admin-permission-toggle ${permission.dangerous ? 'danger' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(bulkPermissions[permission.key])}
                            onChange={(event) =>
                              setBulkPermissions((current) => ({ ...current, [permission.key]: event.target.checked }))
                            }
                          />
                          <span>
                            <strong>{permission.label}</strong>
                            <small>{permission.description}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={() => void applyBulkAccessUpdate()}
                    disabled={accessBusy || !selectedAccessUsers.length || !bulkAccessApps.length}
                  >
                    {accessBusy ? 'Updating...' : 'Apply to selected'}
                  </Button>
                </div>
              </Card>
            </div>

            {accessFeedback ? (
              <div className="admin-warning-item">
                <Badge tone={accessFeedback.toLowerCase().includes('could not') ? 'danger' : 'positive'} dot>
                  Access update
                </Badge>
                <p>{accessFeedback}</p>
              </div>
            ) : null}

            <Card
              title="User access matrix"
              subtitle="Select users, then apply a bulk access template above."
              action={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setSelectedAccessUsers((current) =>
                      allVisibleAccessUsersSelected
                        ? current.filter((id) => !filteredAccessUsers.some((user) => user.id === id))
                        : Array.from(new Set([...current, ...filteredAccessUsers.map((user) => user.id)]))
                    )
                  }
                >
                  {allVisibleAccessUsersSelected ? 'Clear visible' : 'Select visible'}
                </Button>
              }
            >
              <div className="admin-access-toolbar">
                <Input
                  label="Search users"
                  value={accessSearch}
                  onChange={(event) => setAccessSearch(event.target.value)}
                  placeholder="Name, email, role or venue"
                />
                <Select
                  label="Venue"
                  value={accessVenueFilter}
                  onChange={(event) => setAccessVenueFilter(event.target.value)}
                  options={accessVenueOptions}
                />
              </div>
              <div className="admin-access-table-wrap">
                <table className="admin-access-table">
                  <thead>
                    <tr>
                      <th scope="col">Select</th>
                      <th scope="col">User</th>
                      <th scope="col">Venue</th>
                      <th scope="col">Status</th>
                      {accessUsers.apps.map((app) => (
                        <th scope="col" key={app.appId}>{app.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccessUsers.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <input
                            aria-label={`Select ${user.firstName} ${user.lastName}`}
                            type="checkbox"
                            checked={selectedAccessUsers.includes(user.id)}
                            onChange={() => toggleSelectedAccessUser(user.id)}
                          />
                        </td>
                        <td>
                          <strong>{user.firstName} {user.lastName}</strong>
                          <small>{user.email || 'No email'} · {user.roleTitle}</small>
                        </td>
                        <td>{user.venue || 'Unassigned'}</td>
                        <td>
                          <div className="admin-access-status-stack">
                            <Badge tone={user.employmentStatus === 'ACTIVE' ? 'positive' : 'warning'}>
                              {user.employmentStatus.toLowerCase()}
                            </Badge>
                            <Badge tone={user.hasPassword ? 'positive' : 'warning'}>
                              {user.hasPassword ? 'password set' : 'needs setup'}
                            </Badge>
                          </div>
                        </td>
                        {accessUsers.apps.map((app) => {
                          const access = accessFor(user, app.appId);
                          return (
                            <td key={app.appId}>
                              {access ? (
                                <span className={`admin-access-pill ${access.status.toLowerCase()}`}>
                                  {access.status.toLowerCase()} · {access.role.toLowerCase()}
                                </span>
                              ) : (
                                <span className="admin-access-pill disabled">none</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!filteredAccessUsers.length ? (
                <EmptyState
                  icon={<IconUsers />}
                  title="No users match this filter"
                  description="Clear the search or venue filter to see all non-archived staff profiles."
                />
              ) : null}
            </Card>
          </>
        )}
      </section>
      ) : null}

      {(showStaffSettings || showStaffRecordTypes || showStaffOnboarding) ? (
      <section className="admin-section">
        <SectionHeading
          id="defaults"
          eyebrow="Staff setup"
          title={
            showStaffRecordTypes && !showStaffSettings && !showStaffOnboarding
              ? 'Staff record types.'
              : showStaffOnboarding && !showStaffSettings && !showStaffRecordTypes
                ? 'Staff onboarding setup.'
                : 'Staff defaults.'
          }
          description={
            showStaffRecordTypes && !showStaffSettings && !showStaffOnboarding
              ? 'Required certificates, record labels and document rules should be managed from Admin.'
              : showStaffOnboarding && !showStaffSettings && !showStaffRecordTypes
                ? 'Onboarding steps and document upload rules belong in Admin while reviews stay in Staff.'
                : 'Default role, award and Staff app setup links live here.'
          }
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
          <Card title="Setup routes" subtitle="Admin manages these setup areas as migration lands">
            <div className="admin-card-list">
              {ADMIN_SETUP_LINKS.slice(0, 3)
                .filter((link) => {
                  if (showStaffSettings) return true;
                  if (showStaffOnboarding) return link.href.endsWith('/staff-onboarding');
                  if (showStaffRecordTypes) return link.href.endsWith('/staff-record-types');
                  return true;
                })
                .map((link) => (
                <button key={link.title} className="admin-link-card" type="button" onClick={() => { window.location.href = adminRouteHref(link.href, standalone); }}>
                  <span>
                    <strong>{link.title}</strong>
                    <small>{link.body}</small>
                  </span>
                  <IconArrowRight size={16} />
                </button>
              ))}
            </div>
            <div className="toolbar-right">
              <Button type="button" variant="secondary" onClick={() => void openSuiteLink({ appId: 'staff', href: '/settings' })}>
                Open Staff settings editor
              </Button>
            </div>
          </Card>
        </div>
      </section>
      ) : null}

      {(showComplianceSettings || showChecklistTemplates || showAuditTemplates) ? (
      <section className="admin-section">
        <SectionHeading
          id="compliance-settings"
          eyebrow="Compliance setup"
          title={
            showChecklistTemplates && !showComplianceSettings && !showAuditTemplates
              ? 'Checklist templates.'
              : showAuditTemplates && !showComplianceSettings && !showChecklistTemplates
                ? 'Audit templates.'
                : 'Compliance settings.'
          }
          description={
            showChecklistTemplates && !showComplianceSettings && !showAuditTemplates
              ? 'Template management belongs in Admin; running checklists stays in Compliance.'
              : showAuditTemplates && !showComplianceSettings && !showChecklistTemplates
                ? 'Template management belongs in Admin; completing audits stays in Compliance.'
                : 'Compliance keeps daily checklists, audits, incidents and register review. Admin manages setup work.'
          }
        />
        <div className="admin-grid two">
          <Card title="Compliance setup routes" subtitle="Central setup without changing daily Compliance execution">
            <div className="admin-card-list">
              {ADMIN_SETUP_LINKS.slice(3)
                .filter((link) => {
                  if (showComplianceSettings) return true;
                  if (showChecklistTemplates) return link.href.endsWith('/checklist-templates');
                  if (showAuditTemplates) return link.href.endsWith('/audit-templates');
                  return true;
                })
                .map((link) => (
                <button key={link.title} className="admin-link-card" type="button" onClick={() => { window.location.href = adminRouteHref(link.href, standalone); }}>
                  <span>
                    <strong>{link.title}</strong>
                    <small>{link.body}</small>
                  </span>
                  <IconArrowRight size={16} />
                </button>
              ))}
            </div>
            <div className="toolbar-right">
              <Button type="button" variant="secondary" onClick={() => { window.location.href = adminRouteHref('/admin/compliance-settings', standalone); }}>
                {standalone ? 'Open Compliance setup' : 'Open Compliance settings editor'}
              </Button>
            </div>
          </Card>
          <Card title="Daily workflow boundaries" subtitle="What stays out of Admin">
            <div className="admin-boundary-list">
              <div>
                <strong>Checklist runs</strong>
                <span>Start, complete and review checklist runs in Compliance.</span>
              </div>
              <div>
                <strong>Audit runs and incidents</strong>
                <span>Record findings and follow-up work in Compliance.</span>
              </div>
              <div>
                <strong>Handbook reading</strong>
                <span>Staff can keep reading handbook and onboarding content in Compliance.</span>
              </div>
            </div>
          </Card>
        </div>
      </section>
      ) : null}

      {(showIntegrations || showXero) ? (
      <section className="admin-section">
        <SectionHeading
          id="integrations"
          eyebrow={showXero && !showIntegrations ? 'Xero' : 'Integrations'}
          title={showXero && !showIntegrations ? 'Xero integration controls.' : 'Connect the systems that power trading.'}
          description={showXero && !showIntegrations ? 'Preview first, then import selected supplier contacts or bills.' : 'Connection health and setup entry points live here.'}
        />
        <div className="admin-grid three">
          {integrations ? (
            <>
              {(showXero && !showIntegrations ? [integrations.xero] : [integrations.square, integrations.xero]).map((integration) => (
                <IntegrationCard
                  key={integration.provider}
                  integration={integration}
                  busy={integrationBusy}
                  onConnect={(provider) => void connectIntegration(provider)}
                  onDisconnect={(provider) => void disconnectIntegration(provider)}
                  onHealthCheck={integration.provider === 'xero' && showXero ? () => void checkXeroHealth() : undefined}
                  xeroHealth={integration.provider === 'xero' ? xeroHealth : null}
                />
              ))}
              {showIntegrations ? (
                <MetaIntegrationCard
                  meta={integrations.meta}
                  busy={integrationBusy}
                  callbackBanner={callbackBanner}
                  onConnect={connectMeta}
                />
              ) : null}
              {showIntegrations ? (
              <Card title="Email and device services" subtitle="Configured without exposing secrets">
                <div className="admin-status-stack">
                  <StatusLine label="Token storage" value={integrations.tokenStorage.configured ? 'CONFIGURED' : 'NOT CONFIGURED'} tone={integrations.tokenStorage.configured ? 'positive' : 'warning'} />
                  <StatusLine label="Email delivery" value={integrations.email.status.replace(/_/g, ' ')} tone={integrations.email.status === 'CONFIGURED' ? 'positive' : 'danger'} />
                  <StatusLine label="Email provider" value={integrations.email.provider} tone={integrations.email.provider === 'none' ? 'muted' : 'info'} />
                  <StatusLine label="Govee status" value={integrations.govee.status.replace(/_/g, ' ')} tone={integrations.govee.status === 'CONFIGURED' ? 'positive' : 'muted'} />
                </div>
              </Card>
              ) : null}
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
        {integrations && showXero ? (
          <div className="admin-grid two">
            <XeroSyncPanel
              contactPreview={xeroContactPreview}
              billPreview={xeroBillPreview}
              selectedContacts={xeroSelectedContacts}
              selectedBills={xeroSelectedBills}
              busy={xeroSyncBusy}
              feedback={xeroSyncFeedback}
              allowCreateSuppliers={xeroAllowCreateSuppliers}
              onPreviewContacts={() => void previewXeroSupplierContacts()}
              onToggleContact={toggleXeroContact}
              onImportContacts={() => void importXeroSupplierContacts()}
              onPreviewBills={() => void previewXeroSupplierBills()}
              onToggleBill={toggleXeroBill}
              onImportBills={() => void importXeroSupplierBills()}
              onAllowCreateSuppliersChange={setXeroAllowCreateSuppliers}
            />
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
        {integrations && showIntegrations ? (
          <Card
            title="Xero supplier and bill controls"
            subtitle="Health checks, supplier previews, bill previews and selected imports have their own page."
            action={
              <Button type="button" rightIcon={<IconArrowRight size={14} />} onClick={() => { window.location.href = adminRouteHref('/admin/integrations/xero', standalone); }}>
                Open Xero
              </Button>
            }
          />
        ) : null}
        {showIntegrations ? (
        <div className="admin-grid two">
          <Card
            title={editingSocialAccountId ? 'Edit social account' : 'Social publishing setup'}
            subtitle={
              editingSocialAccountId
                ? 'Update platform metadata. Secret references stay hidden and are preserved when left blank.'
                : 'Facebook, Instagram and TikTok readiness in Admin'
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
        ) : null}
      </section>
      ) : null}

      {showHumanAgentDemo ? (
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
      ) : null}

      {showImports ? (
      <section className="admin-section">
        <SectionHeading
          id="imports"
          eyebrow="Data imports"
          title="Imports are named before they are wired."
          description="Admin manages the setup map. Import logic stays in the right app until the integration pass."
        />
        <div className="admin-grid four">
          {DATA_IMPORTS.map((item) => (
            <Card key={item.title} title={item.title} subtitle={item.surface}>
              <p className="admin-card-copy">{item.body}</p>
              <Badge tone="muted">Not checked</Badge>
            </Card>
          ))}
        </div>
      </section>
      ) : null}

      {showAudit ? (
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
      ) : null}

      {showSystemHealth ? (
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
      ) : null}

      {showDangerZone ? (
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
      ) : null}
    </div>
  );
}
