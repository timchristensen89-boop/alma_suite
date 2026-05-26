import { Link } from 'react-router-dom';
import type {
  IncidentSummary,
  IssueSummary,
  StaffSummary,
  TemperatureSummary
} from '@alma/shared';
import { AlmaHomeBubble, Badge, Button, Card, ShieldIcon, StatCard } from '@alma/ui';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canManage } from '../lib/rbac';
import {
  IconArrowRight,
  IconChecklist,
  IconClock,
  IconIncident,
  IconIssues,
  IconPlus,
  IconRefresh,
  IconStaff,
  IconTemperature
} from '../lib/icons';

type DashboardSummary = {
  incidents: IncidentSummary;
  issues: IssueSummary;
  staff: StaffSummary;
  temperatures: TemperatureSummary;
};

const loadSummary = () => api<DashboardSummary>('/api/summary');

export function DashboardPage() {
  const { user } = useAuth();
  const managerAccess = canManage(user);
  const { data, loading, error, reload } = useAsync<DashboardSummary>(loadSummary, []);

  const hasCritical = (data?.issues.critical ?? 0) > 0;
  const outOfRange = data?.temperatures.outOfRangeNow ?? 0;
  const expiring = data?.staff.expiringSoon ?? 0;
  const openIncidents = data?.incidents.open ?? 0;

  // Data-driven editorial header copy per design — leads with whatever the
  // operator needs to see first.
  const openIssues = data?.issues.open ?? 0;
  const overdueChecks = (data?.temperatures.outOfRangeNow ?? 0) + (data?.temperatures.missingToday ?? 0);
  const headerTitle = openIssues > 0 || overdueChecks > 0 ? 'One thing' : 'All quiet';
  const headerItalic = openIssues > 0 || overdueChecks > 0 ? 'needs your eye.' : 'on the floor.';
  const headerSub = (() => {
    if (loading) return 'Loading latest snapshot…';
    if (error) return 'Could not refresh the summary.';
    if (openIssues > 0 && overdueChecks > 0) {
      return `${openIssues} open issue${openIssues === 1 ? '' : 's'} and ${overdueChecks} temperature${overdueChecks === 1 ? '' : 's'} out of range today.`;
    }
    if (openIssues > 0) return `${openIssues} open issue${openIssues === 1 ? '' : 's'} sitting on the board.`;
    if (overdueChecks > 0) return `${overdueChecks} temperature${overdueChecks === 1 ? '' : 's'} out of range today.`;
    return 'Issues, checklists and logs are all current.';
  })();

  return (
    <div className="page-stack">
      <AlmaHomeBubble
        app="compliance"
        appName="Compliance"
        appIcon={<ShieldIcon />}
        eyebrow="Standards command"
        description="Audits, allergens, food safety logs. The unglamorous backbone that keeps the doors open."
        statusLabel={openIssues > 0 ? `${openIssues} open` : 'All venues · today'}
        statusHint={openIssues > 0 || overdueChecks > 0 ? headerSub : 'No issues. Logs are current.'}
        statusDot={openIssues > 0 ? 'terracotta' : overdueChecks > 0 ? 'amber' : 'forest'}
        actions={
          <>
            <Link to="/issues/new" className="alma-home-bubble-btn alma-home-bubble-btn--primary">
              Log now →
            </Link>
            <Link to="/checklists/new" className="alma-home-bubble-btn alma-home-bubble-btn--ghost">
              Pre-audit checklist
            </Link>
          </>
        }
      />

      {error ? (
        <Card
          title="Could not load dashboard summary"
          action={
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<IconRefresh size={14} />}
              onClick={() => void reload()}
            >
              Retry
            </Button>
          }
        >
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      <div className="stats-grid">
        <Link to="/issues" className="stat-card-link" aria-label="Open issues">
          <StatCard
            label="Open issues"
            value={data?.issues.open ?? 0}
            hint={`${data?.issues.total ?? 0} total tracked`}
            icon={<IconIssues size={16} />}
            loading={loading}
          />
        </Link>
        <Link to="/issues" className="stat-card-link" aria-label="Overdue issues">
          <StatCard
            label="Overdue"
            value={data?.issues.overdue ?? 0}
            hint={
              (data?.issues.overdue ?? 0) > 0
                ? 'Past their due date'
                : 'Nothing overdue right now'
            }
            icon={<IconClock size={16} />}
            tone={(data?.issues.overdue ?? 0) > 0 ? 'warning' : 'neutral'}
            loading={loading}
          />
        </Link>
        <Link to="/issues" className="stat-card-link" aria-label="Critical issues">
          <StatCard
            label="Critical"
            value={data?.issues.critical ?? 0}
            hint={hasCritical ? 'Requires immediate attention' : 'No critical flags'}
            icon={<IconIssues size={16} />}
            tone={hasCritical ? 'danger' : 'neutral'}
            loading={loading}
          />
        </Link>
        <Link to="/incidents" className="stat-card-link" aria-label="Open incidents">
          <StatCard
            label="Open incidents"
            value={openIncidents}
            hint={`${data?.incidents.followUpRequired ?? 0} awaiting follow-up`}
            icon={<IconIncident size={16} />}
            tone={openIncidents > 0 ? 'warning' : 'neutral'}
            loading={loading}
          />
        </Link>
      </div>

      {managerAccess ? (
        <div className="stats-grid">
          <Link to="/temperatures" className="stat-card-link" aria-label="Temperature exceptions">
            <StatCard
              label="Temp exceptions"
              value={outOfRange}
              hint={`${data?.temperatures.activeAssets ?? 0} monitored assets`}
              icon={<IconTemperature size={16} />}
              tone={outOfRange > 0 ? 'danger' : 'positive'}
              loading={loading}
            />
          </Link>
          <Link to="/staff" className="stat-card-link" aria-label="Staff expiring">
            <StatCard
              label="Staff expiring"
              value={expiring}
              hint={`${data?.staff.expired ?? 0} already expired`}
              icon={<IconStaff size={16} />}
              tone={expiring > 0 ? 'warning' : 'neutral'}
              loading={loading}
            />
          </Link>
          <Link to="/staff" className="stat-card-link" aria-label="Staff pending approval">
              <StatCard
                label="Staff pending"
                value={data?.staff.pendingApproval ?? 0}
                hint={`${data?.staff.totalProfiles ?? 0} profiles total`}
                icon={<IconStaff size={16} />}
                loading={loading}
              />
            </Link>
            <Link to="/temperatures" className="stat-card-link" aria-label="Missing temperature logs today">
              <StatCard
                label="Missing logs today"
                value={data?.temperatures.missingToday ?? 0}
                hint={`${data?.temperatures.syncedToday ?? 0} synced today`}
                icon={<IconClock size={16} />}
                tone={
                  (data?.temperatures.missingToday ?? 0) > 0 ? 'warning' : 'positive'
                }
                loading={loading}
              />
            </Link>
        </div>
      ) : null}

      <div className="grid two-one">
        <Card
          title="What needs attention"
          subtitle="Grouped triggers from issues, temps, staff, and incidents"
          padding="none"
        >
          <div className="attention-list">
            <AttentionRow
              icon={<IconIssues size={16} />}
              tone={hasCritical ? 'danger' : 'neutral'}
              title="Critical issues"
              value={data?.issues.critical ?? 0}
              hint="Items flagged as critical severity"
              to="/issues"
            />
            <AttentionRow
              icon={<IconClock size={16} />}
              tone={(data?.issues.overdue ?? 0) > 0 ? 'warning' : 'neutral'}
              title="Overdue follow-ups"
              value={data?.issues.overdue ?? 0}
              hint="Open issues past their due date"
              to="/issues"
            />
            {managerAccess ? (
              <>
                <AttentionRow
                  icon={<IconTemperature size={16} />}
                  tone={outOfRange > 0 ? 'danger' : 'positive'}
                  title="Out-of-range fridges"
                  value={outOfRange}
                  hint="Assets with a recent out-of-range reading"
                  to="/temperatures"
                />
                <AttentionRow
                  icon={<IconStaff size={16} />}
                  tone={expiring > 0 ? 'warning' : 'neutral'}
                  title="Staff records expiring"
                  value={expiring}
                  hint="Certificates expiring in the next 30 days"
                  to="/staff"
                />
              </>
            ) : null}
            <AttentionRow
              icon={<IconIncident size={16} />}
              tone={openIncidents > 0 ? 'info' : 'neutral'}
              title="Open incidents"
              value={openIncidents}
              hint="Reported incidents awaiting closeout"
              to="/incidents"
            />
          </div>
        </Card>

        <Card
          title="Quick actions"
          subtitle="Jump into the common compliance flows"
        >
          <div className="page-stack compact">
            <QuickAction
              to="/issues/new"
              title="Log a new issue"
              description="Create an issue with severity, assignee, and due date"
              icon={<IconIssues size={18} />}
            />
            <QuickAction
              to="/checklists/new"
              title="Start a checklist run"
              description="Walk a template end-to-end and turn failures into issues"
              icon={<IconChecklist size={18} />}
            />
            {managerAccess ? (
              <QuickAction
                to="/temperatures"
                title="Review temperatures"
                description="See latest readings and sync govee sensors"
                icon={<IconTemperature size={18} />}
              />
            ) : null}
            <QuickAction
              to="/incidents"
              title="Report an incident"
              description="Capture first aid, injury, or near miss details"
              icon={<IconIncident size={18} />}
            />
          </div>
        </Card>
      </div>

    </div>
  );
}

/* ------------------------------------------------------------------ */

type AttentionTone = 'neutral' | 'positive' | 'warning' | 'danger' | 'info';

function AttentionRow({
  icon,
  tone,
  title,
  value,
  hint,
  to
}: {
  icon: React.ReactNode;
  tone: AttentionTone;
  title: string;
  value: number;
  hint: string;
  to: string;
}) {
  return (
    <Link to={to} className="attention-row">
      <span className={`attention-row-icon tone-${tone}`}>{icon}</span>
      <div className="attention-row-body">
        <strong>{title}</strong>
        <span className="subtle">{hint}</span>
      </div>
      <Badge tone={tone === 'neutral' ? 'muted' : tone}>{value}</Badge>
      <IconArrowRight size={14} className="attention-row-chevron" />
    </Link>
  );
}

function QuickAction({
  to,
  title,
  description,
  icon
}: {
  to: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link to={to} className="quick-action">
      <span className="quick-action-icon">{icon}</span>
      <div className="quick-action-body">
        <strong>{title}</strong>
        <span className="subtle">{description}</span>
      </div>
      <IconArrowRight size={14} className="quick-action-chevron" />
    </Link>
  );
}
