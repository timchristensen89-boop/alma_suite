import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlmaHomeBubble,
  Badge,
  Button,
  Card,
  EmptyState,
  GearIcon,
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
  ChecklistTemplate,
  ShiftTaskAssignmentTarget,
  ShiftTaskDueTiming,
  ShiftTaskRule,
  ShiftTaskRulePreviewResult,
  ShiftTaskType,
  SocialPlatform,
  StaffAppAccess,
  StaffAppAccessStatus,
  StaffRoleTemplate,
  XeroConnectionHealthPayload,
  XeroPayRateSyncResult,
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
  roleTemplates: StaffRoleTemplate[];
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
  | 'shift-task-rules'
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

type RoleTemplateForm = {
  id: string | null;
  name: string;
  description: string;
  roleTitle: string;
  venue: string;
  isActive: boolean;
  access: Partial<Record<AlmaAppId, {
    status: StaffAppAccessStatus;
    role: AccessRole;
    permissions: Record<string, boolean>;
  }>>;
};

const DEFAULT_ROLE_TEMPLATE_FORM: RoleTemplateForm = {
  id: null,
  name: '',
  description: '',
  roleTitle: '',
  venue: '',
  isActive: true,
  access: {}
};

function roleTemplateFormFromTemplate(template: StaffRoleTemplate): RoleTemplateForm {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? '',
    roleTitle: template.roleTitle ?? '',
    venue: template.venue ?? '',
    isActive: template.isActive,
    access: Object.fromEntries(
      template.access.map((access) => [
        access.appId,
        {
          status: access.status,
          role: access.role.toUpperCase() as AccessRole,
          permissions: access.permissions
        }
      ])
    )
  };
}

function roleTemplatePayload(form: RoleTemplateForm, appIds: AlmaAppId[]) {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    roleTitle: form.roleTitle.trim(),
    venue: form.venue.trim(),
    isActive: form.isActive,
    access: appIds.map((appId) => {
      const access = form.access[appId];
      return {
        appId,
        status: access?.status ?? 'DISABLED',
        role: access?.role ?? 'USER',
        permissions: access?.permissions ?? {}
      };
    })
  };
}

function roleTemplateSummary(template: StaffRoleTemplate) {
  const enabled = template.access.filter((access) => access.status === 'ENABLED');
  if (!enabled.length) return 'No apps enabled';
  return enabled.slice(0, 4).map((access) => `${access.appId.toLowerCase()} ${access.role.toLowerCase()}`).join(' · ');
}

function accessFor(user: AdminAccessUserSummary, appId: AlmaAppId): StaffAppAccess | undefined {
  return user.appAccess.find((access) => access.appId === appId);
}

type CallbackBanner = {
  integration: string | null;
  account: string | null;
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
    title: 'Shift task rules',
    body: 'Assign checklists from opening, closing, manager or venue-specific roster shifts.',
    href: '/admin/shift-task-rules'
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
  '/shift-task-rules': 'shift-task-rules',
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
  '/admin/shift-task-rules': 'shift-task-rules',
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
  'shift-task-rules': {
    title: 'Shift task rules',
    description: 'Assign required operational tasks from roster shifts.'
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
      { label: 'Shift task rules', href: '/shift-task-rules', description: 'Assign checklists from roster shifts.' },
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

function AdminCollapsibleSection({
  title,
  summary,
  status,
  defaultOpen = false,
  children
}: {
  title: string;
  summary: string;
  status?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="admin-collapsible-section" open={defaultOpen}>
      <summary>
        <span className="admin-collapsible-title">
          <strong>{title}</strong>
          <small>{summary}</small>
        </span>
        <span className="admin-collapsible-meta">
          {status}
          <span className="admin-collapsible-chevron" aria-hidden="true" />
        </span>
      </summary>
      <div className="admin-collapsible-body">
        {children}
      </div>
    </details>
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

type ShiftTaskRuleForm = {
  name: string;
  enabled: boolean;
  venue: string;
  matchRoleTitle: string;
  matchArea: string;
  matchShiftLabel: string;
  startBeforeMinutes: string;
  startAfterMinutes: string;
  endBeforeMinutes: string;
  endAfterMinutes: string;
  daysOfWeek: string[];
  taskType: ShiftTaskType;
  checklistTemplateId: string;
  stocktakeTemplate: string;
  dueTiming: ShiftTaskDueTiming;
  dueOffsetMinutes: string;
  assignmentTarget: ShiftTaskAssignmentTarget;
};

const DEFAULT_SHIFT_TASK_RULE_FORM: ShiftTaskRuleForm = {
  name: '',
  enabled: true,
  venue: '',
  matchRoleTitle: '',
  matchArea: '',
  matchShiftLabel: '',
  startBeforeMinutes: '',
  startAfterMinutes: '',
  endBeforeMinutes: '',
  endAfterMinutes: '',
  daysOfWeek: [],
  taskType: 'CHECKLIST',
  checklistTemplateId: '',
  stocktakeTemplate: '',
  dueTiming: 'DURING_SHIFT',
  dueOffsetMinutes: '',
  assignmentTarget: 'ASSIGNED_STAFF'
};

const SHIFT_TASK_TYPE_OPTIONS: Array<{ label: string; value: ShiftTaskType }> = [
  { label: 'Checklist', value: 'CHECKLIST' },
  { label: 'Stocktake (planned)', value: 'STOCKTAKE' },
  { label: 'Audit (planned)', value: 'AUDIT' },
  { label: 'Incident check (planned)', value: 'INCIDENT_CHECK' }
];

const SHIFT_TASK_DUE_OPTIONS: Array<{ label: string; value: ShiftTaskDueTiming }> = [
  { label: 'Before shift starts', value: 'BEFORE_SHIFT_START' },
  { label: 'During shift', value: 'DURING_SHIFT' },
  { label: 'Before shift ends', value: 'BEFORE_SHIFT_END' },
  { label: 'After shift ends', value: 'AFTER_SHIFT_END' }
];

const SHIFT_TASK_TARGET_OPTIONS: Array<{ label: string; value: ShiftTaskAssignmentTarget }> = [
  { label: 'Assigned staff member', value: 'ASSIGNED_STAFF' },
  { label: 'Venue iPad queue', value: 'VENUE_QUEUE' },
  { label: 'Manager on duty', value: 'MANAGER_ON_DUTY' },
  { label: 'All on shift', value: 'ALL_ON_SHIFT' }
];

const SHIFT_TASK_DAY_OPTIONS = [
  { label: 'Sun', value: '0' },
  { label: 'Mon', value: '1' },
  { label: 'Tue', value: '2' },
  { label: 'Wed', value: '3' },
  { label: 'Thu', value: '4' },
  { label: 'Fri', value: '5' },
  { label: 'Sat', value: '6' }
];

function minutesPayload(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return Number(trimmed);
}

function shiftTaskRulePayload(form: ShiftTaskRuleForm) {
  return {
    name: form.name,
    enabled: form.enabled,
    venue: form.venue,
    matchRoleTitle: form.matchRoleTitle,
    matchArea: form.matchArea,
    matchShiftLabel: form.matchShiftLabel,
    startBeforeMinutes: minutesPayload(form.startBeforeMinutes),
    startAfterMinutes: minutesPayload(form.startAfterMinutes),
    endBeforeMinutes: minutesPayload(form.endBeforeMinutes),
    endAfterMinutes: minutesPayload(form.endAfterMinutes),
    daysOfWeek: form.daysOfWeek.map((day) => Number(day)),
    taskType: form.taskType,
    checklistTemplateId: form.taskType === 'CHECKLIST' ? form.checklistTemplateId : '',
    stocktakeTemplate: form.taskType === 'STOCKTAKE' ? form.stocktakeTemplate : '',
    dueTiming: form.dueTiming,
    dueOffsetMinutes: minutesPayload(form.dueOffsetMinutes),
    assignmentTarget: form.assignmentTarget
  };
}

function ShiftTaskRulesAdminSection({ venueOptions }: { venueOptions: Array<{ label: string; value: string }> }) {
  const [rules, setRules] = useState<ShiftTaskRule[]>([]);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [form, setForm] = useState<ShiftTaskRuleForm>(DEFAULT_SHIFT_TASK_RULE_FORM);
  const [preview, setPreview] = useState<ShiftTaskRulePreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadShiftTaskRules() {
    setLoading(true);
    setError(null);
    try {
      const [rulePayload, templatePayload] = await Promise.all([
        api<ShiftTaskRule[]>('/api/shift-task-rules'),
        api<ChecklistTemplate[]>('/api/checklists/templates')
      ]);
      setRules(rulePayload);
      setTemplates(templatePayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load shift task rules.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadShiftTaskRules();
  }, []);

  function updateForm<K extends keyof ShiftTaskRuleForm>(key: K, value: ShiftTaskRuleForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleDay(day: string) {
    setForm((current) => ({
      ...current,
      daysOfWeek: current.daysOfWeek.includes(day)
        ? current.daysOfWeek.filter((entry) => entry !== day)
        : [...current.daysOfWeek, day]
    }));
  }

  async function createRule(event: FormEvent) {
    event.preventDefault();
    setBusy('create');
    setError(null);
    setFeedback(null);
    try {
      await api<ShiftTaskRule>('/api/shift-task-rules', {
        method: 'POST',
        body: JSON.stringify(shiftTaskRulePayload(form))
      });
      setForm(DEFAULT_SHIFT_TASK_RULE_FORM);
      setPreview(null);
      setFeedback('Shift task rule created.');
      await loadShiftTaskRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create shift task rule.');
    } finally {
      setBusy(null);
    }
  }

  async function previewRule() {
    setBusy('preview');
    setError(null);
    try {
      const payload = await api<ShiftTaskRulePreviewResult>('/api/shift-task-rules/preview', {
        method: 'POST',
        body: JSON.stringify({ rule: shiftTaskRulePayload(form), venue: form.venue })
      });
      setPreview(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not preview matching shifts.');
    } finally {
      setBusy(null);
    }
  }

  async function toggleRule(rule: ShiftTaskRule) {
    setBusy(rule.id);
    setError(null);
    try {
      await api<ShiftTaskRule>(`/api/shift-task-rules/${rule.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !rule.enabled })
      });
      await loadShiftTaskRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update shift task rule.');
    } finally {
      setBusy(null);
    }
  }

  const createDisabled =
    busy === 'create' ||
    !form.name.trim() ||
    (form.taskType === 'CHECKLIST' && !form.checklistTemplateId);

  return (
    <div className="admin-grid two">
      <Card title="Create a shift task rule" subtitle="When a roster shift matches this rule, Alma creates the required task.">
        <form className="admin-social-form" onSubmit={(event) => void createRule(event)}>
          <div className="admin-form-grid">
            <Input
              label="Rule name"
              value={form.name}
              onChange={(event) => updateForm('name', event.target.value)}
              placeholder="Opening checklist for opening shifts"
              required
            />
            <Select
              label="Venue"
              value={form.venue}
              onChange={(event) => updateForm('venue', event.target.value)}
              options={[{ label: 'All venues', value: '' }, ...venueOptions]}
            />
            <Select
              label="Task type"
              value={form.taskType}
              onChange={(event) => updateForm('taskType', event.target.value as ShiftTaskType)}
              options={SHIFT_TASK_TYPE_OPTIONS}
            />
          </div>

          <div className="admin-form-grid">
            <Input
              label="Match role/title"
              value={form.matchRoleTitle}
              onChange={(event) => updateForm('matchRoleTitle', event.target.value)}
              placeholder="manager, bartender, kitchen"
            />
            <Input
              label="Match area"
              value={form.matchArea}
              onChange={(event) => updateForm('matchArea', event.target.value)}
              placeholder="Bar, Kitchen, Floor"
            />
            <Input
              label="Match label/notes"
              value={form.matchShiftLabel}
              onChange={(event) => updateForm('matchShiftLabel', event.target.value)}
              placeholder="opening, closing, prep"
            />
          </div>

          <div className="admin-form-grid">
            <Input
              label="Starts before minute"
              type="number"
              min="0"
              max="1440"
              value={form.startBeforeMinutes}
              onChange={(event) => updateForm('startBeforeMinutes', event.target.value)}
              placeholder="540 for 9:00am"
            />
            <Input
              label="Starts after minute"
              type="number"
              min="0"
              max="1440"
              value={form.startAfterMinutes}
              onChange={(event) => updateForm('startAfterMinutes', event.target.value)}
              placeholder="900 for 3:00pm"
            />
            <Input
              label="Ends before minute"
              type="number"
              min="0"
              max="1440"
              value={form.endBeforeMinutes}
              onChange={(event) => updateForm('endBeforeMinutes', event.target.value)}
              placeholder="1020 for 5:00pm"
            />
            <Input
              label="Ends after minute"
              type="number"
              min="0"
              max="1440"
              value={form.endAfterMinutes}
              onChange={(event) => updateForm('endAfterMinutes', event.target.value)}
              placeholder="1260 for 9:00pm"
            />
          </div>

          <div className="admin-chip-grid">
            {SHIFT_TASK_DAY_OPTIONS.map((day) => (
              <label key={day.value} className="admin-check-chip">
                <input
                  type="checkbox"
                  checked={form.daysOfWeek.includes(day.value)}
                  onChange={() => toggleDay(day.value)}
                />
                <span>{day.label}</span>
              </label>
            ))}
          </div>

          <div className="admin-form-grid">
            {form.taskType === 'CHECKLIST' ? (
              <Select
                label="Checklist template"
                value={form.checklistTemplateId}
                onChange={(event) => updateForm('checklistTemplateId', event.target.value)}
                options={[
                  { label: 'Choose a checklist', value: '' },
                  ...templates.map((template) => ({ label: template.name, value: template.id }))
                ]}
              />
            ) : (
              <Input
                label="Planned task label"
                value={form.stocktakeTemplate}
                onChange={(event) => updateForm('stocktakeTemplate', event.target.value)}
                placeholder="Stocktake task linking is coming next"
              />
            )}
            <Select
              label="Due timing"
              value={form.dueTiming}
              onChange={(event) => updateForm('dueTiming', event.target.value as ShiftTaskDueTiming)}
              options={SHIFT_TASK_DUE_OPTIONS}
            />
            <Input
              label="Due offset minutes"
              type="number"
              value={form.dueOffsetMinutes}
              onChange={(event) => updateForm('dueOffsetMinutes', event.target.value)}
              placeholder="30"
            />
          </div>

          <div className="admin-form-grid">
            <Select
              label="Assignment target"
              value={form.assignmentTarget}
              onChange={(event) => updateForm('assignmentTarget', event.target.value as ShiftTaskAssignmentTarget)}
              options={SHIFT_TASK_TARGET_OPTIONS}
            />
            <label className="admin-checkbox">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => updateForm('enabled', event.target.checked)}
              />
              <span>Enable this rule immediately</span>
            </label>
          </div>

          {form.taskType !== 'CHECKLIST' ? (
            <p className="muted">Only checklist tasks can be started from Staff and Compliance in this release.</p>
          ) : null}

          {error ? <p className="form-error">{error}</p> : null}
          {feedback ? <p className="form-success">{feedback}</p> : null}

          <div className="toolbar-right">
            <Button type="button" variant="secondary" onClick={() => void previewRule()} disabled={busy === 'preview' || !form.name.trim()}>
              {busy === 'preview' ? 'Previewing...' : 'Preview matches'}
            </Button>
            <Button type="submit" disabled={createDisabled}>
              {busy === 'create' ? 'Creating...' : 'Create rule'}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Current rules" subtitle="Checklist rules are active. Stocktake, audit and incident task types are planned.">
        {loading ? (
          <Spinner label="Loading shift task rules..." />
        ) : rules.length ? (
          <div className="admin-card-list">
            {rules.map((rule) => (
              <article key={rule.id} className="admin-link-card">
                <span>
                  <strong>{rule.name}</strong>
                  <small>
                    {rule.venue || 'All venues'} · {rule.taskType.toLowerCase().replace(/_/g, ' ')}
                    {rule.checklistTemplate?.name ? ` · ${rule.checklistTemplate.name}` : ''}
                  </small>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={rule.enabled ? 'secondary' : 'ghost'}
                  onClick={() => void toggleRule(rule)}
                  disabled={busy === rule.id}
                >
                  {rule.enabled ? 'Enabled' : 'Disabled'}
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<IconChecklist />}
            title="No shift task rules yet"
            description="Create an opening, closing or manager checklist rule to start assigning work from shifts."
          />
        )}

        {preview ? (
          <div className="admin-status-stack">
            <StatusLine label="Preview matches" value={`${preview.matchCount}`} tone={preview.matchCount ? 'positive' : 'muted'} />
            <div className="admin-card-list">
              {preview.matches.slice(0, 5).map((match) => (
                <div key={match.assignmentKey} className="admin-mini-card">
                  <div>
                    <strong>{match.staffName || 'Venue queue'}</strong>
                    <small>{match.shiftLabel} · due {match.dueAt ? formatDate(match.dueAt) : 'during shift'}</small>
                  </div>
                  <Badge tone="info">{match.venue || 'All venues'}</Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
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

function xeroScheduledTone(status: AdminIntegrationsStatusPayload['xeroScheduledImport']) {
  if (!status?.schedulerSecretConfigured) return 'warning';
  if (status.lastStatus === 'ERROR') return 'danger';
  if (status.lastStatus === 'SUCCESS') return 'positive';
  return 'info';
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
  const integration = params.get('integration');
  if (integration !== 'meta' && integration !== 'square') return null;
  return {
    integration,
    account: params.get('account'),
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
  onSyncPayRates,
  onRefresh,
  onSyncLocations,
  onImportSales,
  onSyncCatalog,
  onImportItemSales,
  onImportTips,
  onImportCustomers,
  callbackBanner,
  xeroHealth
}: {
  integration: IntegrationProviderStatus;
  busy: string | null;
  onConnect: (integration: IntegrationProviderStatus) => void;
  onDisconnect: (integration: IntegrationProviderStatus) => void;
  onHealthCheck?: () => void;
  onSyncPayRates?: () => void;
  onRefresh?: () => void;
  onSyncLocations?: () => void;
  onImportSales?: () => void;
  onSyncCatalog?: () => void;
  onImportItemSales?: () => void;
  onImportTips?: () => void;
  onImportCustomers?: () => void;
  callbackBanner?: CallbackBanner;
  xeroHealth?: XeroConnectionHealthPayload | null;
}) {
  const accountSuffix = integration.accountKey ? `:${integration.accountKey}` : '';
  const isBusy = busy === `${integration.provider}${accountSuffix}`;
  const isHealthBusy = busy === `${integration.provider}${accountSuffix}-health`;
  const isSyncPayRatesBusy = busy === 'xero-sync-pay-rates';
  const isRefreshBusy = busy === `square${accountSuffix}-refresh`;
  const isSyncBusy = busy === `square${accountSuffix}-sync-locations`;
  const isImportSalesBusy = busy === `square${accountSuffix}-import-sales`;
  const isSyncCatalogBusy = busy === `square${accountSuffix}-sync-catalog`;
  const isImportItemSalesBusy = busy === `square${accountSuffix}-import-item-sales`;
  const isImportTipsBusy = busy === `square${accountSuffix}-import-tips`;
  const isImportCustomersBusy = busy === `square${accountSuffix}-import-customers`;
  const isXero = integration.provider === 'xero';
  const isSquare = integration.provider === 'square';
  const squareSetup = integration.squareSetup;
  const squareAccountTitle = isSquare
    ? `${integration.accountKey === 'secondary' ? 'Secondary Square' : 'Primary Square'}, ${squareSetup?.label ?? integration.label}`
    : integration.label;
  const squareMissingLabels = squareSetup?.missingLabels ?? [];
  const squareSetupComplete = squareSetup?.configured ?? integration.configured;
  const cardSubtitle = isSquare
    ? squareSetupComplete
      ? integration.status === 'CONNECTED'
        ? 'Connected and ready'
        : 'Ready to connect'
      : 'Setup incomplete'
    : integration.configured
      ? 'Connection ready'
      : 'Setup required';
  const squareWebhookUrl = squareSetup?.webhookUrl ?? integration.webhookUrl ?? null;
  const squareRedirectUri = squareSetup?.redirectUri ?? integration.redirectUri ?? null;
  const squareLocationCount = squareSetup?.locationCount ?? integration.locationCount ?? null;
  const squareLastWebhookAt = squareSetup?.lastWebhookAt ?? integration.webhookLastReceivedAt ?? null;
  const squareWebhookEventCount = squareSetup?.webhookEventCount ?? integration.webhookEventCount ?? 0;
  const squareCallbackBanner = isSquare && callbackBanner?.integration === 'square' && (!callbackBanner.account || callbackBanner.account === integration.accountKey)
    ? callbackBanner
    : null;

  return (
    <AdminCollapsibleSection
      title={squareAccountTitle}
      summary={cardSubtitle}
      defaultOpen={Boolean(squareCallbackBanner) || integration.status === 'ERROR'}
      status={
        <>
          <Badge tone={integrationTone(integration.status)}>{integration.status.replace(/_/g, ' ')}</Badge>
          {isSquare ? (
            <Badge tone={squareSetupComplete ? 'positive' : 'warning'}>
              {squareSetupComplete ? 'Configured' : `${squareMissingLabels.length || 1} missing`}
            </Badge>
          ) : null}
        </>
      }
    >
      <Card>
      <div className="admin-provider-card">
        <Badge tone={integrationTone(integration.status)}>{integration.status.replace(/_/g, ' ')}</Badge>
        {isSquare ? (
          <Badge tone={squareSetupComplete ? 'positive' : 'warning'}>
            {squareSetupComplete ? 'Ready to connect' : 'Setup incomplete'}
          </Badge>
        ) : null}
        {squareCallbackBanner ? (
          <div className="admin-warning-item">
            <Badge tone={squareCallbackBanner.status === 'connected' ? 'positive' : 'warning'}>
              {squareCallbackBanner.status.replace(/_/g, ' ')}
            </Badge>
            <p>
              {squareCallbackBanner.reason
                ? `Square OAuth returned: ${squareCallbackBanner.reason.replace(/_/g, ' ')}.`
                : 'Square OAuth returned to Admin.'}
            </p>
          </div>
        ) : null}
        <p className="muted">Connection tokens are stored securely on the server and are never exposed in the browser.</p>
        <div>
          <strong>Powers</strong>
          <p>{integration.powers.join(', ')}</p>
        </div>
        <div>
          <strong>Scopes</strong>
          <p>{integration.scopes.length ? integration.scopes.join(', ') : 'No scopes stored yet'}</p>
        </div>
        <div>
          <strong>Account</strong>
          <p>{integration.providerAccountName ?? integration.providerAccountId ?? 'Not connected yet'}</p>
        </div>
        <div>
          <strong>Last sync</strong>
          <p>{integration.lastSyncAt ? formatDate(integration.lastSyncAt) : 'No syncs yet'}</p>
        </div>
        {isSquare ? (
          <>
            <div>
              <strong>Redirect URI</strong>
              <p>{squareRedirectUri ?? 'Not configured'}</p>
            </div>
            <div>
              <strong>Webhook URL</strong>
              <p>{squareWebhookUrl ?? 'Not configured'}</p>
            </div>
            <div>
              <strong>Setup steps</strong>
              <p>Create this Square app, add the redirect URI and webhook URL above, store this account's app credentials and webhook signature key in API env/secrets, then connect from here.</p>
            </div>
            <div className="admin-status-stack">
              <StatusLine label="OAuth config" value={squareSetup?.oauthConfigured ? 'Configured' : 'Missing'} tone={squareSetup?.oauthConfigured ? 'positive' : 'warning'} />
              <StatusLine label="Environment" value={integration.environment ?? 'Not configured'} tone={integration.environment === 'production' ? 'warning' : 'info'} />
              <StatusLine label="API version" value={integration.apiVersion ?? 'Not configured'} tone="muted" />
              <StatusLine label="Webhook key" value={squareSetup?.webhookConfigured ? 'Configured' : 'Missing'} tone={squareSetup?.webhookConfigured ? 'positive' : 'warning'} />
              <StatusLine label="Webhook events" value={String(squareWebhookEventCount)} tone={squareWebhookEventCount ? 'info' : 'muted'} />
              <StatusLine label="Last webhook" value={squareLastWebhookAt ? formatDate(squareLastWebhookAt) : 'No events yet'} tone="muted" />
              <StatusLine label="Webhook failures" value={String(integration.webhookFailedEventCount ?? 0)} tone={(integration.webhookFailedEventCount ?? 0) ? 'danger' : 'muted'} />
              <StatusLine label="Locations" value={squareLocationCount === null || squareLocationCount === undefined ? 'Not synced' : String(squareLocationCount)} tone={squareLocationCount ? 'positive' : 'muted'} />
              <StatusLine label="Location sync" value={integration.lastLocationSyncAt ? formatDate(integration.lastLocationSyncAt) : 'No location sync yet'} tone="muted" />
            </div>
            {squareMissingLabels.length ? (
              <div>
                <strong>Missing</strong>
                <ul className="admin-device-policy-list">
                  {squareMissingLabels.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              </div>
            ) : squareSetupComplete ? (
              <div>
                <strong>Setup</strong>
                <p>Ready to connect. Use the account-scoped Connect button for this Square app.</p>
              </div>
            ) : (
              <div>
                <strong>Setup</strong>
                <p>{integration.connectBlockedReason ?? 'Server-side Square setup is incomplete.'}</p>
              </div>
            )}
            {integration.locations?.length ? (
              <div className="admin-status-stack">
                {integration.locations.slice(0, 5).map((location) => (
                  <StatusLine
                    key={location.id}
                    label={location.name}
                    value={[location.status, location.currency, location.timezone].filter(Boolean).join(' · ') || 'Square location'}
                    tone={location.status === 'ACTIVE' ? 'positive' : 'muted'}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : null}
        {isXero ? (
          <div>
            <strong>Accounting &amp; payroll sync</strong>
            <p>Supplier contacts and bills can be imported. Pay rates can be synced from Xero Payroll using the button below — this requires the <code>payroll.employees.read</code> scope (re-authorise Xero if recently added). Payments and bank feeds stay excluded.</p>
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
        {!isSquare && integration.missingEnvVars.length ? (
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
            onClick={() => onConnect(integration)}
          >
            {isBusy ? 'Opening...' : integration.actionLabel}
          </Button>
          {integration.status === 'CONNECTED' ? (
            <Button variant="ghost" disabled={isBusy} onClick={() => onDisconnect(integration)}>
              Disconnect locally
            </Button>
          ) : null}
          {isXero && onHealthCheck ? (
            <Button variant="secondary" disabled={isHealthBusy} onClick={onHealthCheck}>
              {isHealthBusy ? 'Checking...' : 'Check Xero health'}
            </Button>
          ) : null}
          {isXero && onSyncPayRates ? (
            <Button variant="secondary" disabled={isSyncPayRatesBusy || integration.status !== 'CONNECTED'} onClick={onSyncPayRates}>
              {isSyncPayRatesBusy ? 'Syncing pay rates...' : 'Sync pay rates from Xero'}
            </Button>
          ) : null}
          {isSquare && onHealthCheck ? (
            <Button variant="secondary" disabled={isHealthBusy} onClick={onHealthCheck}>
              {isHealthBusy ? 'Checking...' : 'Check Square health'}
            </Button>
          ) : null}
          {isSquare && onSyncLocations ? (
            <Button variant="secondary" disabled={isSyncBusy} onClick={onSyncLocations}>
              {isSyncBusy ? 'Syncing...' : 'Sync locations'}
            </Button>
          ) : null}
          {isSquare && onImportSales ? (
            <Button variant="secondary" disabled={isImportSalesBusy || integration.status !== 'CONNECTED'} onClick={onImportSales}>
              {isImportSalesBusy ? 'Importing...' : 'Import sales'}
            </Button>
          ) : null}
          {isSquare && onImportItemSales ? (
            <Button variant="secondary" disabled={isImportItemSalesBusy || integration.status !== 'CONNECTED'} onClick={onImportItemSales}>
              {isImportItemSalesBusy ? 'Importing...' : 'Import item sales'}
            </Button>
          ) : null}
          {isSquare && onSyncCatalog ? (
            <Button variant="secondary" disabled={isSyncCatalogBusy || integration.status !== 'CONNECTED'} onClick={onSyncCatalog}>
              {isSyncCatalogBusy ? 'Syncing...' : 'Sync catalog'}
            </Button>
          ) : null}
          {isSquare && onImportTips ? (
            <Button variant="secondary" disabled={isImportTipsBusy || integration.status !== 'CONNECTED'} onClick={onImportTips}>
              {isImportTipsBusy ? 'Importing...' : 'Import tips'}
            </Button>
          ) : null}
          {isSquare && onImportCustomers ? (
            <Button variant="primary" disabled={isImportCustomersBusy || integration.status !== 'CONNECTED'} onClick={onImportCustomers}>
              {isImportCustomersBusy ? 'Importing customers...' : 'Import customers → guest CRM'}
            </Button>
          ) : null}
          {isSquare && onRefresh ? (
            <Button variant="ghost" disabled={isRefreshBusy} onClick={onRefresh}>
              {isRefreshBusy ? 'Refreshing...' : 'Refresh token'}
            </Button>
          ) : null}
        </div>
        {integration.connectBlockedReason ? <p className="muted">{integration.connectBlockedReason}</p> : null}
      </div>
      </Card>
    </AdminCollapsibleSection>
  );
}

function XeroSyncPanel({
  scheduledImport,
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
  scheduledImport?: AdminIntegrationsStatusPayload['xeroScheduledImport'];
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
    <AdminCollapsibleSection
      title="Xero supplier and bill import"
      summary="Preview first, then import selected records"
      defaultOpen={Boolean(contactPreview || billPreview || feedback)}
      status={
        <>
          <Badge tone={xeroScheduledTone(scheduledImport)}>
            {scheduledImport?.schedulerSecretConfigured ? 'Scheduler ready' : 'Scheduler setup needed'}
          </Badge>
          {feedback ? <Badge tone="info">Preview active</Badge> : null}
        </>
      }
    >
      <Card>
      <div className="admin-status-stack">
        <p className="muted">
          Automatic Xero import is limited to supplier contacts and safe matched ACCPAY supplier bills. Preview remains available below for manual review. Payroll, payments and bank feeds are not connected.
        </p>
        {scheduledImport ? (
          <div className="admin-status-stack">
            <StatusLine
              label="Scheduler endpoint"
              value={scheduledImport.schedulerSecretConfigured ? 'Ready' : 'Secret missing'}
              tone={scheduledImport.schedulerSecretConfigured ? 'positive' : 'warning'}
            />
            <StatusLine
              label="Endpoint"
              value={scheduledImport.endpoint}
              tone="muted"
            />
            <StatusLine
              label="Last scheduled run"
              value={scheduledImport.lastScheduledRunAt ? formatDate(scheduledImport.lastScheduledRunAt) : 'No scheduled run recorded'}
              tone={scheduledImport.lastStatus === 'ERROR' ? 'danger' : scheduledImport.lastStatus === 'SUCCESS' ? 'positive' : 'muted'}
            />
            <StatusLine
              label="Recent scheduled runs"
              value={String(scheduledImport.recentRunCount)}
              tone={scheduledImport.recentRunCount ? 'info' : 'muted'}
            />
            {scheduledImport.lastError ? (
              <p className="muted">Last scheduler note: {scheduledImport.lastError}</p>
            ) : null}
            <div className="admin-grid two">
              <div className="admin-provider-card">
                <strong>Automatic import includes</strong>
                <ul className="admin-device-policy-list">
                  {scheduledImport.importScope.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <div className="admin-provider-card">
                <strong>Still excluded</strong>
                <ul className="admin-device-policy-list">
                  {scheduledImport.excludedScope.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            </div>
          </div>
        ) : null}
        {feedback ? <Badge tone="info">{feedback}</Badge> : null}
        <div className="admin-grid two xero-import-grid">
          <div className="admin-provider-card xero-import-card">
            <div className="xero-import-card-head">
              <strong>Supplier contacts</strong>
              <p>Review Xero contacts that are marked as suppliers, then create or update selected Alma suppliers.</p>
            </div>
            <div className="inline-actions xero-import-actions">
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

          <div className="admin-provider-card xero-import-card">
            <div className="xero-import-card-head">
              <strong>Supplier bills</strong>
              <p>Preview recent Xero ACCPAY bills, match suppliers, then import selected bills into Stock invoices.</p>
            </div>
            <div className="inline-actions xero-import-actions">
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
    </AdminCollapsibleSection>
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
    <AdminCollapsibleSection
      title={meta.label}
      summary="Business Login for Facebook and Instagram"
      defaultOpen={Boolean(callbackBanner) || displayStatus === 'TOKEN_STORAGE_PENDING'}
      status={<Badge tone={metaTone(displayStatus)}>{displayStatus.replace(/_/g, ' ')}</Badge>}
    >
      <Card>
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
    </AdminCollapsibleSection>
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
    socialAccounts: [],
    roleTemplates: []
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
  const [xeroPayRateSyncResult, setXeroPayRateSyncResult] = useState<XeroPayRateSyncResult | null>(null);
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
  const [roleTemplateForm, setRoleTemplateForm] = useState<RoleTemplateForm>(DEFAULT_ROLE_TEMPLATE_FORM);
  const [roleTemplateBusy, setRoleTemplateBusy] = useState<string | null>(null);
  const [roleTemplateFeedback, setRoleTemplateFeedback] = useState<string | null>(null);
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
      const [overviewResult, accessUsersResult, integrationsResult, systemHealthResult, socialAccountsResult, roleTemplatesResult] = await Promise.allSettled([
        api<AdminOverviewPayload>('/api/admin/overview'),
        api<AdminAccessUsersPayload>('/api/admin/access/users'),
        api<AdminIntegrationsStatusPayload>('/api/admin/integrations/status'),
        api<AdminSystemHealthPayload>('/api/admin/system-health'),
        api<MarketingSocialAccount[]>('/api/marketing/content/social-accounts'),
        api<StaffRoleTemplate[]>('/api/staff/role-templates?includeInactive=true')
      ]);

      if (overviewResult.status === 'rejected') throw overviewResult.reason;
      if (systemHealthResult.status === 'rejected') throw systemHealthResult.reason;

      setState({
        overview: overviewResult.value,
        accessUsers: accessUsersResult.status === 'fulfilled' ? accessUsersResult.value : null,
        integrations: integrationsResult.status === 'fulfilled' ? integrationsResult.value : null,
        systemHealth: systemHealthResult.value,
        socialAccounts: socialAccountsResult.status === 'fulfilled' ? socialAccountsResult.value : [],
        roleTemplates: roleTemplatesResult.status === 'fulfilled' ? roleTemplatesResult.value : []
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

  function integrationAccountQuery(integration: IntegrationProviderStatus) {
    return integration.provider === 'square' && integration.accountKey ? `?account=${encodeURIComponent(integration.accountKey)}` : '';
  }

  function integrationBusyKey(integration: IntegrationProviderStatus, action = '') {
    const accountSuffix = integration.accountKey ? `:${integration.accountKey}` : '';
    return `${integration.provider}${accountSuffix}${action}`;
  }

  async function connectIntegration(integration: IntegrationProviderStatus) {
    setIntegrationBusy(integrationBusyKey(integration));
    try {
      const payload = await api<IntegrationConnectResponse>(`/api/integrations/${integration.provider}/connect${integrationAccountQuery(integration)}`, {
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

  async function disconnectIntegration(integration: IntegrationProviderStatus) {
    setIntegrationBusy(integrationBusyKey(integration));
    try {
      await api(`/api/integrations/${integration.provider}/disconnect${integrationAccountQuery(integration)}`, { method: 'POST' });
      if (integration.provider === 'xero') setXeroHealth(null);
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

  async function syncXeroPayRates() {
    setIntegrationBusy('xero-sync-pay-rates');
    setError(null);
    setXeroPayRateSyncResult(null);
    try {
      const result = await api<XeroPayRateSyncResult>('/api/integrations/xero/sync-pay-rates', {
        method: 'POST'
      });
      setXeroPayRateSyncResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sync pay rates from Xero.');
    } finally {
      setIntegrationBusy(null);
    }
  }

  async function checkSquareHealth(integration: IntegrationProviderStatus) {
    setIntegrationBusy(integrationBusyKey(integration, '-health'));
    setError(null);
    try {
      await api(`/api/integrations/square/health-check${integrationAccountQuery(integration)}`, { method: 'POST' });
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check Square health.');
    } finally {
      setIntegrationBusy(null);
    }
  }

  async function refreshSquareToken(integration: IntegrationProviderStatus) {
    setIntegrationBusy(integrationBusyKey(integration, '-refresh'));
    setError(null);
    try {
      await api(`/api/integrations/square/refresh${integrationAccountQuery(integration)}`, { method: 'POST' });
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not refresh Square token.');
    } finally {
      setIntegrationBusy(null);
    }
  }

  async function syncSquareLocations(integration: IntegrationProviderStatus) {
    setIntegrationBusy(integrationBusyKey(integration, '-sync-locations'));
    setError(null);
    try {
      await api(`/api/integrations/square/sync-locations${integrationAccountQuery(integration)}`, { method: 'POST' });
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sync Square locations.');
    } finally {
      setIntegrationBusy(null);
    }
  }

  async function importSquareSales(integration: IntegrationProviderStatus) {
    const days = window.prompt('How many days of Square sales should we import? (1–365)', '14');
    if (days === null) return;
    const lookbackDays = Math.max(1, Math.min(365, Number(days) || 14));
    setIntegrationBusy(integrationBusyKey(integration, '-import-sales'));
    setError(null);
    try {
      const result = await api<{ imported?: number; updated?: number; rowsCount?: number; warnings?: string[] }>(`/api/integrations/square/import-sales${integrationAccountQuery(integration)}`, {
        method: 'POST',
        body: JSON.stringify({ lookbackDays, limit: 5000 })
      });
      await loadDashboard();
      window.alert(`Square sales imported.\nLast ${lookbackDays} days · ${result.imported ?? 0} new / ${result.updated ?? 0} updated rows.${(result.warnings ?? []).map((w) => `\n• ${w}`).join('')}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import Square sales.');
    } finally {
      setIntegrationBusy(null);
    }
  }

  async function syncSquareCatalog(integration: IntegrationProviderStatus) {
    setIntegrationBusy(integrationBusyKey(integration, '-sync-catalog'));
    setError(null);
    try {
      const result = await api<{ candidatesUpserted?: number; suggestionsCreated?: number; warnings?: string[] }>(`/api/integrations/square/sync-catalog${integrationAccountQuery(integration)}`, {
        method: 'POST'
      });
      await loadDashboard();
      window.alert(`Square catalog synced.\n${result.candidatesUpserted ?? 0} items refreshed, ${result.suggestionsCreated ?? 0} recipe-match suggestions.${(result.warnings ?? []).map((w) => `\n• ${w}`).join('')}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sync Square catalog.');
    } finally {
      setIntegrationBusy(null);
    }
  }

  async function importSquareItemSales(integration: IntegrationProviderStatus) {
    const days = window.prompt('How many days of Square item-level sales should we import? (1–90)', '14');
    if (days === null) return;
    const lookbackDays = Math.max(1, Math.min(90, Number(days) || 14));
    setIntegrationBusy(integrationBusyKey(integration, '-import-item-sales'));
    setError(null);
    try {
      const end = new Date();
      const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
      const result = await api<{ imported?: number; updated?: number; ordersRead?: number; itemRows?: number; warnings?: string[] }>(`/api/integrations/square/import-item-sales${integrationAccountQuery(integration)}`, {
        method: 'POST',
        body: JSON.stringify({ start: start.toISOString(), end: end.toISOString(), lookbackDays })
      });
      await loadDashboard();
      window.alert(`Square item sales imported.\nLast ${lookbackDays} days · ${result.ordersRead ?? 0} orders → ${result.itemRows ?? 0} line items (${result.imported ?? 0} new / ${result.updated ?? 0} updated).${(result.warnings ?? []).map((w) => `\n• ${w}`).join('')}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import Square item sales.');
    } finally {
      setIntegrationBusy(null);
    }
  }

  async function importSquareTips(integration: IntegrationProviderStatus) {
    const venue = window.prompt('Which venue should the tips be credited to?', 'Alma Avalon');
    if (!venue) return;
    const days = window.prompt('How many days of tip data? (1–62)', '14');
    if (days === null) return;
    const lookbackDays = Math.max(1, Math.min(62, Number(days) || 14));
    setIntegrationBusy(integrationBusyKey(integration, '-import-tips'));
    setError(null);
    try {
      const end = new Date();
      const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
      const result = await api<{ imported?: number; updated?: number; tipRows?: number; amountCents?: number; warnings?: string[] }>(`/api/integrations/square/import-tips${integrationAccountQuery(integration)}`, {
        method: 'POST',
        body: JSON.stringify({ start: start.toISOString(), end: end.toISOString(), venue })
      });
      await loadDashboard();
      const dollars = ((result.amountCents ?? 0) / 100).toFixed(2);
      window.alert(`Square tips imported for ${venue}.\n${result.tipRows ?? 0} tip payments · $${dollars} total · ${result.imported ?? 0} new / ${result.updated ?? 0} updated.${(result.warnings ?? []).map((w) => `\n• ${w}`).join('')}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import Square tips.');
    } finally {
      setIntegrationBusy(null);
    }
  }

  async function importSquareCustomers(integration: IntegrationProviderStatus) {
    const venue = window.prompt('Default venue for imported customers (optional — leave blank to use the first Square location):', '');
    if (venue === null) return;
    const daysRaw = window.prompt('Only import customers updated within the last N days. Leave blank to import everyone Square has on file.', '');
    if (daysRaw === null) return;
    const updatedSinceDays = daysRaw.trim() ? Math.max(1, Math.min(3650, Number(daysRaw) || 365)) : undefined;
    setIntegrationBusy(integrationBusyKey(integration, '-import-customers'));
    setError(null);
    try {
      const result = await api<{ imported?: number; updated?: number; skipped?: number; customersRead?: number; warnings?: string[] }>(`/api/integrations/square/import-customers${integrationAccountQuery(integration)}`, {
        method: 'POST',
        body: JSON.stringify({
          defaultVenue: venue.trim() || undefined,
          ...(updatedSinceDays != null ? { updatedSinceDays } : {})
        })
      });
      await loadDashboard();
      window.alert(`Square customers imported into Reserve guests.\n${result.customersRead ?? 0} Square customers read → ${result.imported ?? 0} new guests, ${result.updated ?? 0} updated, ${result.skipped ?? 0} skipped (no name/email/phone).${(result.warnings ?? []).map((w) => `\n• ${w}`).join('')}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not import Square customers.');
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

  function updateRoleTemplateAccess(
    appId: AlmaAppId,
    patch: Partial<{ status: StaffAppAccessStatus; role: AccessRole; permissions: Record<string, boolean> }>
  ) {
    setRoleTemplateForm((form) => {
      const current = form.access[appId] ?? { status: 'DISABLED' as StaffAppAccessStatus, role: 'USER' as AccessRole, permissions: {} };
      return {
        ...form,
        access: {
          ...form.access,
          [appId]: {
            ...current,
            ...patch,
            permissions: patch.permissions ?? current.permissions
          }
        }
      };
    });
  }

  function toggleRoleTemplatePermission(appId: AlmaAppId, key: string, checked: boolean) {
    const current = roleTemplateForm.access[appId] ?? { status: 'DISABLED' as StaffAppAccessStatus, role: 'USER' as AccessRole, permissions: {} };
    updateRoleTemplateAccess(appId, {
      permissions: {
        ...current.permissions,
        [key]: checked
      }
    });
  }

  async function saveRoleTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state.accessUsers) return;
    setRoleTemplateBusy('save');
    setRoleTemplateFeedback(null);
    try {
      const payload = roleTemplatePayload(roleTemplateForm, state.accessUsers.apps.map((app) => app.appId));
      await api<StaffRoleTemplate>(roleTemplateForm.id ? `/api/staff/role-templates/${roleTemplateForm.id}` : '/api/staff/role-templates', {
        method: roleTemplateForm.id ? 'PATCH' : 'POST',
        body: JSON.stringify(payload)
      });
      setRoleTemplateForm(DEFAULT_ROLE_TEMPLATE_FORM);
      setRoleTemplateFeedback(roleTemplateForm.id ? 'Role template saved.' : 'Role template created.');
      await loadDashboard();
    } catch (err) {
      setRoleTemplateFeedback(err instanceof Error ? err.message : 'Could not save role template.');
    } finally {
      setRoleTemplateBusy(null);
    }
  }

  async function archiveRoleTemplate(template: StaffRoleTemplate) {
    const confirmed = window.confirm(`Archive ${template.name}? Staff already assigned keep the role label until changed.`);
    if (!confirmed) return;
    setRoleTemplateBusy(template.id);
    setRoleTemplateFeedback(null);
    try {
      await api<StaffRoleTemplate>(`/api/staff/role-templates/${template.id}`, { method: 'DELETE' });
      if (roleTemplateForm.id === template.id) setRoleTemplateForm(DEFAULT_ROLE_TEMPLATE_FORM);
      setRoleTemplateFeedback(`${template.name} archived.`);
      await loadDashboard();
    } catch (err) {
      setRoleTemplateFeedback(err instanceof Error ? err.message : 'Could not archive role template.');
    } finally {
      setRoleTemplateBusy(null);
    }
  }

  async function duplicateRoleTemplate(template: StaffRoleTemplate) {
    setRoleTemplateBusy(`duplicate:${template.id}`);
    setRoleTemplateFeedback(null);
    try {
      const copy = await api<StaffRoleTemplate>(`/api/staff/role-templates/${template.id}/duplicate`, { method: 'POST' });
      setRoleTemplateForm(roleTemplateFormFromTemplate(copy));
      setRoleTemplateFeedback(`${template.name} duplicated. Review and activate the copy before use.`);
      await loadDashboard();
    } catch (err) {
      setRoleTemplateFeedback(err instanceof Error ? err.message : 'Could not duplicate role template.');
    } finally {
      setRoleTemplateBusy(null);
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
  const roleTemplates = state.roleTemplates;
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
  const showShiftTaskRules = isAll || activeRoute === 'shift-task-rules';
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
      <AlmaHomeBubble
        app="admin"
        appName="Admin"
        appIcon={<GearIcon />}
        eyebrow="Admin command"
        description={routeCopy.description}
        statusLabel={routeCopy.title}
        statusHint={loading ? 'Refreshing admin data…' : `Generated ${formatDate(overview.generatedAt)}`}
        statusDot={overview.readiness.status === 'ready' ? 'forest' : 'amber'}
        actions={
          <>
            <button
              type="button"
              className="alma-home-bubble-btn alma-home-bubble-btn--primary"
              onClick={() => void loadDashboard()}
              disabled={loading}
            >
              Refresh →
            </button>
            {standalone && !isOverview ? (
              <button
                type="button"
                className="alma-home-bubble-btn alma-home-bubble-btn--ghost"
                onClick={() => { window.location.href = '/'; }}
              >
                Admin home
              </button>
            ) : null}
          </>
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
        <a href="#business">Business and venues</a>
        <a href="#access">Users and access</a>
        <a href="#permission-editor">Permission editor</a>
        <a href="#defaults">Apps and defaults</a>
        <a href="#compliance-settings">Compliance setup</a>
        <a href="#shift-task-rules">Shift task rules</a>
        <a href="#integrations">Integrations</a>
        <a href="#human-agent-demo">Human Agent Demo</a>
        <a href="#imports">Data imports</a>
        <a href="#audit">Audit log</a>
        <a href="#system-health">System health</a>
      </nav>
      ) : null}

      {(isAll || isOverview) && integrations ? (
        (() => {
          // One-line integration health strip — green / amber / red dot per
          // provider, jumps to the full Integration Health page on click.
          // Doesn't replace the standalone health page; it's a glance.
          type DotTone = 'positive' | 'warning' | 'danger' | 'muted';
          type Dot = { id: string; label: string; tone: DotTone; detail?: string };
          const dots: Dot[] = [];

          // Email service
          dots.push({
            id: 'email',
            label: 'Email',
            tone: integrations.email.status === 'CONFIGURED' ? 'positive' : 'danger',
            detail: integrations.email.status === 'CONFIGURED'
              ? `Provider: ${integrations.email.provider}`
              : 'Not configured'
          });

          // Token storage
          dots.push({
            id: 'token-storage',
            label: 'Token storage',
            tone: integrations.tokenStorage.configured ? 'positive' : 'danger',
            detail: integrations.tokenStorage.configured ? 'Configured' : 'Missing INTEGRATION_TOKEN_ENCRYPTION_KEY'
          });

          // Square — connected, configured-but-not-connected, or error
          const primarySquare = integrations.squareAccounts?.primary ?? integrations.square;
          const squareTone: DotTone = primarySquare?.status === 'ERROR'
            ? 'danger'
            : primarySquare?.status === 'CONNECTED'
              ? 'positive'
              : primarySquare?.configured
                ? 'warning'
                : 'muted';
          dots.push({
            id: 'square',
            label: 'Square',
            tone: squareTone,
            detail: primarySquare?.status?.replace(/_/g, ' ') ?? 'Not configured'
          });

          // Xero
          const xeroTone: DotTone = integrations.xero?.status === 'ERROR'
            ? 'danger'
            : integrations.xero?.status === 'CONNECTED'
              ? 'positive'
              : integrations.xero?.configured
                ? 'warning'
                : 'muted';
          dots.push({
            id: 'xero',
            label: 'Xero',
            tone: xeroTone,
            detail: integrations.xero?.status?.replace(/_/g, ' ') ?? 'Not configured'
          });

          // Meta — never reaches 'CONNECTED' yet (Marketing is in Preview);
          // "Ready to connect" is the best we report today.
          const metaTone: DotTone =
            integrations.meta?.status === 'CALLBACK_RECEIVED' || integrations.meta?.status === 'READY_TO_CONNECT'
              ? 'warning'
              : integrations.meta?.status === 'TOKEN_STORAGE_PENDING'
                ? 'danger'
                : 'muted';
          dots.push({
            id: 'meta',
            label: 'Meta',
            tone: metaTone,
            detail: integrations.meta?.status?.replace(/_/g, ' ') ?? 'Not configured'
          });

          // Govee
          const goveeHasError = Boolean(integrations.govee.lastError);
          const goveeTone: DotTone = goveeHasError
            ? 'danger'
            : integrations.govee.status === 'CONFIGURED'
              ? 'positive'
              : 'muted';
          dots.push({
            id: 'govee',
            label: 'Govee',
            tone: goveeTone,
            detail: goveeHasError
              ? integrations.govee.lastError ?? 'Error'
              : integrations.govee.status === 'CONFIGURED'
                ? `${integrations.govee.sensorCount ?? 0} sensors`
                : 'Not configured'
          });

          const healthHref = standalone ? '/admin/integrations/health' : '/?admin=integrations';
          return (
            <a className="admin-health-strip" href={healthHref} aria-label="Open integration health">
              <span className="admin-health-strip-label">Integration health</span>
              {dots.map((dot) => (
                <span key={dot.id} className={`admin-health-strip-dot is-${dot.tone}`} title={`${dot.label} · ${dot.detail ?? ''}`}>
                  <span className="admin-health-strip-bead" aria-hidden="true" />
                  <span className="admin-health-strip-text">{dot.label}</span>
                </span>
              ))}
              <span className="admin-health-strip-cta" aria-hidden="true">View health →</span>
            </a>
          );
        })()
      ) : null}

      {(isAll || isOverview) ? (
        (() => {
          // Operational debt list — single curated place that surfaces
          // known temporary gaps so they don't live in the owner's head.
          // Hand-maintained until we have a model for it. The whole point
          // is the reviewer's #53 from the second High School pass.
          type DebtTone = 'warning' | 'danger' | 'info';
          const items: Array<{ id: string; label: string; detail: string; tone: DebtTone }> = [
            {
              id: 'reserve-preview',
              label: 'Reserve in Preview',
              detail: 'SevenRooms remains the source of truth for live bookings. Anything in Alma Reserve is for testing layout, capacity logic, and the public widget.',
              tone: 'warning'
            },
            {
              id: 'marketing-preview',
              label: 'Marketing in Preview',
              detail: 'Live email / SMS / social sends are disabled. Drafts and segments can be built; nothing goes to customers until consent + send paths are verified.',
              tone: 'warning'
            },
            {
              id: 'roster-deputy',
              label: 'Roster source: Deputy',
              detail: 'Alma Staff shows roster data imported from Deputy. Deputy stays the editor of record until Alma roster scheduling is fully exercised.',
              tone: 'info'
            },
            {
              id: 'stripe-test-mode',
              label: 'Gift Cards Stripe mode',
              detail: 'Check Admin → Integrations to confirm Stripe is in Live mode before promoting public gift card purchase to customers.',
              tone: 'info'
            },
            {
              id: 'menu-mapping',
              label: 'Square menu mapping coverage',
              detail: 'Some Square menu items don\'t yet have recipe mappings, which affects COGS accuracy in menu engineering reports. See Reports → Menu engineering.',
              tone: 'info'
            },
            {
              id: 'meta-tiktok',
              label: 'Meta / TikTok engagement read-back',
              detail: 'Performance page is live in Marketing — but live Meta Graph API insights need page tokens persisted after the OAuth callback. Until then the Performance page returns simulated numbers tagged "Simulated" so the surface is real but the values are obviously not.',
              tone: 'info'
            },
            {
              id: 'marketing-social-live',
              label: 'Live social publishing (Meta / TikTok)',
              detail: 'Email campaigns can now send live. Social post publishing (Meta / Instagram / TikTok) is still simulation-only until page tokens are persisted post-OAuth and MARKETING_SOCIAL_LIVE_PUBLISH_ENABLED=true is set.',
              tone: 'info'
            }
          ];
          // Recent release notes — hand-curated so the owner can see at a
          // glance what's just shipped. Add new entries at the top.
          const releaseNotes: Array<{ date: string; items: string[] }> = [
            {
              date: '27 May 2026',
              items: [
                'Pay-change approval workflow: managers submit, a different admin approves. Audit trail on every step.',
                'End-of-shift wrap: structured close-of-day prompt in Comms · Handover (incidents, complaints, stock, maintenance, notes).',
                'Manager Daily Brief at /brief: today\'s sales, wage %, approvals waiting, heads-ups, in a 10-second glance.',
                'Venue Readiness at /readiness: green / amber / red view of today\'s opening, service and closing checklists.',
                'Suite-wide Feedback button on every internal app — bug / idea / praise straight into the team inbox.',
                'Scheduled CSV exports in Admin (sales by day, wages by week, timesheets, stocktake variance, low stock).',
                'Public gift cards: cleaner trust panel with proper icons, expiry transparency, and a 3-question FAQ.',
                'Field-level redaction on staff profiles: pay / bank / TFN / super / DOB show "Hidden" instead of leaking to managers without HR perms.',
                'Marketing Performance page (Phase 4.7 foundation): post engagement surface with simulated metrics until Meta page tokens are persisted.',
                'Deputy CSV import stop-gap on the roster header — paste / upload, dry-run preview, idempotent re-import.',
                'Tips week selector now uses the editorial roster nav for visual continuity.',
                'Marketing → Pilot: live campaign email send shipped with test-first + admin-only + 24h test window + recipient cap + audit trail.',
                'Reserve → Pilot: booking confirmation emails working, public widget live. Banner updated from "preview" to "pilot" — Reserve is now your source of truth, not SevenRooms.',
                'Loaded replacement tracker at Admin → System → Loaded replacement: cutover checklist, parallel comparison cycles, and a hard cancellation guard that stays RED until every required check is ready and two comparisons are explained.',
                'Stock catalogue gained countUnit + conversionFactor + countArea + latestCostCents + latestCostAt for proper stocktake by physical area + COGS confidence.',
                'Stocktake state machine: IN_PROGRESS → SUBMITTED → REVIEWED → LOCKED → REOPENED. Reports prefer LOCKED stocktakes. Reopen requires a reason (≥5 characters) for the audit trail.',
                'Stocktake CSV export at /stocktakes/:id/export.csv — one row per line, includes the latest cost + stock value.',
                'Sprint 2: Loaded item CSV import with preview → commit, classifies rows as create / update / skip / error.',
                'Sprint 2: Historical Loaded stocktake CSV import — lands as LOCKED sessions tagged "Imported from Loaded".',
                'Sprint 2: Comparison form on the Loaded replacement page so admins can record + explain parallel-run variance cycles.',
                'Sprint 2: Reports now shows a per-venue stocktake status hairline (Good / Partial / Poor + last-locked date) so the operator knows whether stock value can be trusted.'
              ]
            },
            {
              date: 'Earlier this week',
              items: [
                'Roster board big separation: each venue carries its own day labels, white pill backgrounds on paper-cream.',
                'Mobile pass on daily flows: clock-in, shift acceptance, checklist sign-off all sized for a phone.',
                'Govee temperature hourly Cloud Scheduler + Monday weekly summary email.',
                'Xero supplier and bill import buttons aligned; Square customer / item-sales / tips importers added.',
                'HR privacy callouts on every record page; auth middleware now returns role-aware permission text.'
              ]
            },
            {
              date: 'Earlier',
              items: [
                'Suite-wide editorial design system (Cormorant Garamond + Avenir, paper-cream surfaces).',
                'AlmaHomeBubble headers on every app, lifecycle chips (live / pilot / preview) on the switcher.',
                'Alma Home (alma-home.web.app) with venue iPad mode and role-aware launcher tiles.',
                'Manager dashboard wired to real data; integration health strip on Admin overview.'
              ]
            }
          ];
          return (
            <section className="admin-section">
              <div className="admin-debt-card">
                <header className="admin-debt-head">
                  <span className="admin-debt-eyebrow">Operational debt</span>
                  <h2 className="admin-debt-title">Known gaps you don't have to carry</h2>
                  <p className="admin-debt-sub">
                    Things that are intentionally not done yet. Listed here so they stay visible and don't surprise anyone in production.
                  </p>
                </header>
                <ul className="admin-debt-list">
                  {items.map((item) => (
                    <li key={item.id} className={`admin-debt-row is-${item.tone}`}>
                      <span className="admin-debt-row-tag">{item.label}</span>
                      <span className="admin-debt-row-detail">{item.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="admin-release-notes">
                <header className="admin-release-head">
                  <span className="admin-release-eyebrow">What's new</span>
                  <h2 className="admin-release-title">Recent releases</h2>
                  <p className="admin-release-sub">
                    The shortlist of what shipped recently. Stays here so the team — and you — remember what changed and when.
                  </p>
                </header>
                <ol className="admin-release-list">
                  {releaseNotes.map((release) => (
                    <li key={release.date} className="admin-release-item">
                      <span className="admin-release-date">{release.date}</span>
                      <ul className="admin-release-bullets">
                        {release.items.map((line, index) => (
                          <li key={index}>{line}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          );
        })()
      ) : null}

      {(isAll || isOverview) ? (
      <section className="admin-section">
        <div className="admin-exports-card">
          <header className="admin-release-head">
            <span className="admin-release-eyebrow">Scheduled exports</span>
            <h2 className="admin-release-title">Download standard CSVs</h2>
            <p className="admin-release-sub">
              Manual exports today. Cloud Scheduler + Google Drive drop is the next layer — these endpoints are the foundation.
              Pulls the last 30 days unless you change the dates in the URL.
            </p>
          </header>
          <div className="admin-exports-grid">
            {[
              { kind: 'sales-by-day', label: 'Sales by day', detail: 'One row per venue per day with sales total.' },
              { kind: 'wages-by-week', label: 'Wages by week', detail: 'ISO-week hours, wages, shifts per venue.' },
              { kind: 'timesheets', label: 'Timesheets', detail: 'Approved + pending timesheets with hours and wages.' },
              { kind: 'stocktake-variance', label: 'Stocktake variance', detail: 'Recent counts vs expected, value impact.' },
              { kind: 'low-stock', label: 'Low stock snapshot', detail: 'Items below par level right now.' }
            ].map((item) => (
              <a
                key={item.kind}
                className="admin-link-card"
                href={`/api/admin/exports/${item.kind}`}
              >
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <IconArrowRight size={16} />
              </a>
            ))}
          </div>
        </div>
      </section>
      ) : null}

      {(isAll || isOverview) ? (
      <section className="admin-section">
        <div className="admin-settings-link-list">
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
          eyebrow="Roles and permissions"
          title="Role templates control staff app access."
          description="Create a role once, then assign it to staff from the Staff app. Direct user access remains available as an override."
        />

        <div className="admin-grid two">
          <Card title="Role templates" subtitle="Active templates appear in Staff role dropdowns. Archived templates stay out of new assignments.">
            <div className="admin-card-list">
              {roleTemplates.map((template) => (
                <article key={template.id} className="admin-link-card">
                  <span>
                    <strong>{template.name}</strong>
                    <small>
                      {template.isActive ? 'Active' : 'Archived'} · {template.assignedStaffCount ?? 0} assigned · {roleTemplateSummary(template)}
                    </small>
                  </span>
                  <span className="inline-actions">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRoleTemplateForm(roleTemplateFormFromTemplate(template))}>
                      Edit
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={roleTemplateBusy === `duplicate:${template.id}`} onClick={() => void duplicateRoleTemplate(template)}>
                      Duplicate
                    </Button>
                    <Button type="button" size="sm" variant="secondary" disabled={roleTemplateBusy === template.id || !template.isActive} onClick={() => void archiveRoleTemplate(template)}>
                      Archive
                    </Button>
                  </span>
                </article>
              ))}
              {!roleTemplates.length ? (
                <EmptyState
                  icon={<IconUsers />}
                  title="No role templates yet"
                  description="Create the first role template, then use it from Staff when adding or editing people."
                />
              ) : null}
            </div>
          </Card>

          <Card title={roleTemplateForm.id ? 'Edit role template' : 'Create role template'} subtitle="App permission groups are collapsed by default. Save applies this template to future role changes.">
            <form className="admin-social-form" onSubmit={(event) => void saveRoleTemplate(event)}>
              <div className="admin-form-grid">
                <Input
                  label="Role name"
                  value={roleTemplateForm.name}
                  onChange={(event) => setRoleTemplateForm((form) => ({ ...form, name: event.target.value }))}
                  placeholder="Venue Manager"
                  required
                />
                <Input
                  label="Role title"
                  value={roleTemplateForm.roleTitle}
                  onChange={(event) => setRoleTemplateForm((form) => ({ ...form, roleTitle: event.target.value }))}
                  placeholder="Venue Manager"
                />
                <Select
                  label="Default venue"
                  value={roleTemplateForm.venue}
                  onChange={(event) => setRoleTemplateForm((form) => ({ ...form, venue: event.target.value }))}
                  options={[{ label: 'No default venue', value: '' }, ...venueOptions]}
                />
              </div>
              <Textarea
                label="Description"
                rows={2}
                value={roleTemplateForm.description}
                onChange={(event) => setRoleTemplateForm((form) => ({ ...form, description: event.target.value }))}
                placeholder="What this role is allowed to do"
              />

              {accessUsers ? (
                <div className="admin-role-template-apps">
                  {accessUsers.apps.map((app) => {
                    const access = roleTemplateForm.access[app.appId] ?? { status: 'DISABLED' as StaffAppAccessStatus, role: 'USER' as AccessRole, permissions: {} };
                    return (
                      <details key={app.appId} className="admin-role-app-group">
                        <summary>
                          <span>{app.label}</span>
                          <Badge tone={access.status === 'ENABLED' ? 'positive' : 'muted'}>{access.status.toLowerCase()}</Badge>
                        </summary>
                        <div className="admin-form-grid">
                          <Select
                            label="Status"
                            value={access.status}
                            onChange={(event) => updateRoleTemplateAccess(app.appId, { status: event.target.value as StaffAppAccessStatus })}
                            options={ACCESS_STATUS_OPTIONS}
                          />
                          <Select
                            label="Role"
                            value={access.role}
                            onChange={(event) => updateRoleTemplateAccess(app.appId, { role: event.target.value as AccessRole })}
                            options={ACCESS_ROLE_OPTIONS}
                          />
                        </div>
                        <div className="admin-permission-grid">
                          {accessUsers.permissionKeys.map((permission) => (
                            <label key={`${app.appId}:${permission.key}`} className={`admin-permission-toggle ${permission.dangerous ? 'danger' : ''}`}>
                              <input
                                type="checkbox"
                                checked={Boolean(access.permissions[permission.key])}
                                onChange={(event) => toggleRoleTemplatePermission(app.appId, permission.key, event.target.checked)}
                              />
                              <span>
                                <strong>{permission.label}</strong>
                                <small>{permission.description}</small>
                              </span>
                            </label>
                          ))}
                        </div>
                      </details>
                    );
                  })}
                </div>
              ) : (
                <EmptyState title="Permission keys unavailable" description="Admin access data did not load, so role template permissions cannot be edited yet." />
              )}

              <label className="admin-checkbox">
                <input
                  type="checkbox"
                  checked={roleTemplateForm.isActive}
                  onChange={(event) => setRoleTemplateForm((form) => ({ ...form, isActive: event.target.checked }))}
                />
                <span>Active for Staff role dropdowns</span>
              </label>
              {roleTemplateFeedback ? (
                <p className={roleTemplateFeedback.toLowerCase().includes('could not') ? 'form-error' : 'form-success'}>
                  {roleTemplateFeedback}
                </p>
              ) : null}
              <div className="toolbar-right">
                {roleTemplateForm.id ? (
                  <Button type="button" variant="ghost" onClick={() => setRoleTemplateForm(DEFAULT_ROLE_TEMPLATE_FORM)}>
                    Cancel
                  </Button>
                ) : null}
                <Button type="submit" disabled={roleTemplateBusy === 'save' || !roleTemplateForm.name.trim() || !accessUsers}>
                  {roleTemplateBusy === 'save' ? 'Saving...' : roleTemplateForm.id ? 'Save role' : 'Create role'}
                </Button>
              </div>
            </form>
          </Card>
        </div>

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
            <details className="admin-role-app-group">
              <summary>
                <span>Direct user access overrides</span>
                <Badge tone="info">Advanced</Badge>
              </summary>
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
            </details>
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

      {(showComplianceSettings || showChecklistTemplates || showShiftTaskRules || showAuditTemplates) ? (
      <section className="admin-section">
        <SectionHeading
          id="compliance-settings"
          eyebrow="Compliance setup"
          title={
            showChecklistTemplates && !showComplianceSettings && !showAuditTemplates
              ? 'Checklist templates.'
              : showShiftTaskRules && !showComplianceSettings && !showChecklistTemplates && !showAuditTemplates
                ? 'Shift task rules.'
                : showAuditTemplates && !showComplianceSettings && !showChecklistTemplates && !showShiftTaskRules
                ? 'Audit templates.'
                : 'Compliance settings.'
          }
          description={
            showChecklistTemplates && !showComplianceSettings && !showAuditTemplates
              ? 'Template management belongs in Admin; running checklists stays in Compliance.'
              : showShiftTaskRules && !showComplianceSettings && !showChecklistTemplates && !showAuditTemplates
                ? 'Assign opening, closing and manager checklists from roster shifts.'
                : showAuditTemplates && !showComplianceSettings && !showChecklistTemplates && !showShiftTaskRules
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
                  if (showShiftTaskRules) return link.href.endsWith('/shift-task-rules');
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
        {showShiftTaskRules ? (
          <div className="admin-section" id="shift-task-rules">
            <ShiftTaskRulesAdminSection venueOptions={venueOptions} />
          </div>
        ) : null}
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
        <div className="admin-integration-list">
          {integrations ? (
            <>
              {(showXero && !showIntegrations
                ? [integrations.xero]
                : [
                    integrations.squareAccounts?.primary ?? integrations.square,
                    integrations.squareAccounts?.secondary,
                    integrations.xero
                  ].filter((integration): integration is IntegrationProviderStatus => Boolean(integration))
              ).map((integration) => (
                <IntegrationCard
                  key={`${integration.provider}:${integration.accountKey ?? 'default'}`}
                  integration={integration}
                  busy={integrationBusy}
                  onConnect={(nextIntegration) => void connectIntegration(nextIntegration)}
                  onDisconnect={(nextIntegration) => void disconnectIntegration(nextIntegration)}
                  onHealthCheck={
                    integration.provider === 'xero' && showXero
                      ? () => void checkXeroHealth()
                      : integration.provider === 'square'
                        ? () => void checkSquareHealth(integration)
                        : undefined
                  }
                  onSyncPayRates={integration.provider === 'xero' && showXero ? () => void syncXeroPayRates() : undefined}
                  onRefresh={integration.provider === 'square' ? () => void refreshSquareToken(integration) : undefined}
                  onSyncLocations={integration.provider === 'square' ? () => void syncSquareLocations(integration) : undefined}
                  onImportSales={integration.provider === 'square' ? () => void importSquareSales(integration) : undefined}
                  onSyncCatalog={integration.provider === 'square' ? () => void syncSquareCatalog(integration) : undefined}
                  onImportItemSales={integration.provider === 'square' ? () => void importSquareItemSales(integration) : undefined}
                  onImportTips={integration.provider === 'square' ? () => void importSquareTips(integration) : undefined}
                  onImportCustomers={integration.provider === 'square' ? () => void importSquareCustomers(integration) : undefined}
                  callbackBanner={callbackBanner}
                  xeroHealth={integration.provider === 'xero' ? xeroHealth : null}
                />
              ))}
              {showIntegrations ? (
                <MetaIntegrationCard
                  meta={integrations.meta}
                  busy={integrationBusy}
                  callbackBanner={callbackBanner?.integration === 'meta' ? callbackBanner : null}
                  onConnect={connectMeta}
                />
              ) : null}
              {showIntegrations ? (
                <AdminCollapsibleSection
                  title="Email and device services"
                  summary="Configured without exposing secrets"
                  status={<Badge tone={integrations.email.status === 'CONFIGURED' && integrations.tokenStorage.configured ? 'positive' : 'warning'}>Setup</Badge>}
                >
                  <Card>
                    <div className="admin-status-stack">
                      <StatusLine label="Token storage" value={integrations.tokenStorage.configured ? 'CONFIGURED' : 'NOT CONFIGURED'} tone={integrations.tokenStorage.configured ? 'positive' : 'warning'} />
                      <StatusLine label="Email delivery" value={integrations.email.status.replace(/_/g, ' ')} tone={integrations.email.status === 'CONFIGURED' ? 'positive' : 'danger'} />
                      <StatusLine label="Email provider" value={integrations.email.provider} tone={integrations.email.provider === 'none' ? 'muted' : 'info'} />
                      <StatusLine label="Govee status" value={integrations.govee.status.replace(/_/g, ' ')} tone={integrations.govee.status === 'CONFIGURED' ? 'positive' : 'muted'} />
                    </div>
                  </Card>
                </AdminCollapsibleSection>
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
              scheduledImport={integrations.xeroScheduledImport}
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
            {xeroPayRateSyncResult ? (
              <AdminCollapsibleSection
                title="Pay rates synced"
                summary={`${xeroPayRateSyncResult.synced} updated · ${xeroPayRateSyncResult.notMatched} unmatched · ${xeroPayRateSyncResult.skipped} skipped`}
                defaultOpen
                status={<Badge tone={xeroPayRateSyncResult.synced > 0 ? 'positive' : 'info'}>{xeroPayRateSyncResult.synced} updated</Badge>}
              >
                <Card>
                  <div className="admin-status-stack">
                    <StatusLine label="Updated" value={String(xeroPayRateSyncResult.synced)} tone="positive" />
                    <StatusLine label="Not matched" value={String(xeroPayRateSyncResult.notMatched)} tone={xeroPayRateSyncResult.notMatched > 0 ? 'warning' : 'muted'} />
                    <StatusLine label="Skipped (no rate)" value={String(xeroPayRateSyncResult.skipped)} tone="muted" />
                  </div>
                  {xeroPayRateSyncResult.updated.length > 0 ? (
                    <div>
                      <strong>Updated staff</strong>
                      <div className="admin-status-stack">
                        {xeroPayRateSyncResult.updated.map((row) => (
                          <StatusLine
                            key={row.staffId}
                            label={`${row.firstName} ${row.lastName}`}
                            value={`$${(row.newPayRateCents / 100).toFixed(2)}/hr${row.previousPayRateCents !== null ? ` (was $${(row.previousPayRateCents / 100).toFixed(2)})` : ' (new)'}`}
                            tone="positive"
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {xeroPayRateSyncResult.unmatched.length > 0 ? (
                    <div>
                      <strong>Unmatched Xero employees</strong>
                      <p className="muted">These employees were found in Xero but could not be matched to a staff profile. Link them by adding the Xero Employee ID to each staff profile.</p>
                      <div className="admin-status-stack">
                        {xeroPayRateSyncResult.unmatched.map((row) => (
                          <StatusLine
                            key={row.xeroEmployeeId}
                            label={`${row.firstName} ${row.lastName}`}
                            value={row.email ?? row.xeroEmployeeId}
                            tone="warning"
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </Card>
              </AdminCollapsibleSection>
            ) : null}
            <AdminCollapsibleSection
              title="Sync health"
              summary="Last connection and webhook activity"
              status={<Badge tone={integrations.latestSyncRuns.length ? 'info' : 'muted'}>{integrations.latestSyncRuns.length} runs</Badge>}
            >
              <Card>
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
            </AdminCollapsibleSection>
          </div>
        ) : null}
        {integrations && showIntegrations ? (
          <AdminCollapsibleSection
            title="Xero supplier and bill controls"
            summary="Health checks, previews and selected imports have their own page"
            status={<Badge tone="info">Linked page</Badge>}
          >
            <Card
              action={
                <Button type="button" rightIcon={<IconArrowRight size={14} />} onClick={() => { window.location.href = adminRouteHref('/admin/integrations/xero', standalone); }}>
                  Open Xero
                </Button>
              }
            />
          </AdminCollapsibleSection>
        ) : null}
        {showIntegrations ? (
        <div className="admin-grid two">
          <AdminCollapsibleSection
            title={editingSocialAccountId ? 'Edit social account' : 'Social publishing setup'}
            summary={
              editingSocialAccountId
                ? 'Update platform metadata. Secret references stay hidden and are preserved when left blank.'
                : 'Facebook, Instagram and TikTok readiness in Admin'
            }
            defaultOpen={Boolean(editingSocialAccountId || socialFeedback)}
            status={<Badge tone={editingSocialAccountId ? 'info' : 'muted'}>{editingSocialAccountId ? 'Editing' : 'Collapsed'}</Badge>}
          >
            <Card>
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
          </AdminCollapsibleSection>
          <AdminCollapsibleSection
            title="Configured social accounts"
            summary="No raw tokens are returned to Admin"
            status={<Badge tone={state.socialAccounts.length ? 'info' : 'muted'}>{state.socialAccounts.length} accounts</Badge>}
          >
            <Card>
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
          </AdminCollapsibleSection>
          <AdminCollapsibleSection
            title="Readiness result"
            summary="Connector checks for the selected account"
            defaultOpen={Boolean(socialReadiness)}
            status={<Badge tone={socialReadiness?.ready ? 'positive' : socialReadiness ? 'warning' : 'muted'}>{socialReadiness ? 'Checked' : 'No check'}</Badge>}
          >
            <Card>
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
          </AdminCollapsibleSection>
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
