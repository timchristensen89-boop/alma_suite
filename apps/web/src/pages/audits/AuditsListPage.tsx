import { Link } from 'react-router-dom';
import type { AuditRun, AuditSummary, AuditTemplate } from '@alma/shared';
import {
  ActionFeedback,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  StatCard
} from '@alma/ui';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import {
  IconArrowRight,
  IconAudit,
  IconCheck,
  IconClock,
  IconPlus,
  IconRefresh
} from '../../lib/icons';

export function AuditsListPage() {
  const templates = useAsync<AuditTemplate[]>(() => api('/api/audits/templates'), []);
  const runs = useAsync<AuditRun[]>(() => api('/api/audits/runs'), []);
  const summary = useAsync<AuditSummary>(() => api('/api/audits/meta'), []);

  const rows = runs.data ?? [];
  const openFindings = summary.data?.openFindings ?? 0;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Audits"
        title="Internal audits & health inspections"
        description="Run a health inspection checklist, record findings, and turn anything that failed into a tracked issue."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<IconRefresh size={14} />}
              onClick={() => {
                void templates.reload();
                void runs.reload();
                void summary.reload();
              }}
            >
              Refresh
            </Button>
            <Link to="/audits/new">
              <Button leftIcon={<IconPlus size={14} />}>New audit</Button>
            </Link>
          </>
        }
      />

      <div className="stats-grid">
        <StatCard
          label="Audits run"
          value={summary.data?.totalRuns ?? 0}
          hint="All time"
          icon={<IconAudit size={16} />}
          loading={summary.loading}
        />
        <StatCard
          label="This month"
          value={summary.data?.thisMonth ?? 0}
          hint={`As of ${new Date().toLocaleDateString()}`}
          icon={<IconClock size={16} />}
          loading={summary.loading}
        />
        <StatCard
          label="Open findings"
          value={openFindings}
          hint={openFindings > 0 ? 'Findings still outstanding' : 'All findings closed out'}
          icon={<IconAudit size={16} />}
          tone={openFindings > 0 ? 'warning' : 'positive'}
          loading={summary.loading}
        />
        <StatCard
          label="Average score"
          value={summary.data?.averageScore ?? '—'}
          hint="Scored audits only"
          icon={<IconCheck size={16} />}
          loading={summary.loading}
        />
      </div>

      <div className="grid two-one">
        <Card padding="none">
          <div className="table-toolbar">
            <span>
              {runs.loading ? (
                <Spinner label="Loading audits…" />
              ) : (
                <>
                  <strong style={{ color: 'var(--color-text)' }}>{rows.length}</strong>{' '}
                  {rows.length === 1 ? 'audit run' : 'audit runs'} recorded
                </>
              )}
            </span>
            <div className="table-toolbar-right">
              <Link to="/audits/new">
                <Button size="sm" variant="secondary" leftIcon={<IconPlus size={14} />}>
                  Start audit
                </Button>
              </Link>
            </div>
          </div>

          {!runs.loading && !runs.error && rows.length === 0 ? (
            <EmptyState
              icon={<IconAudit size={22} />}
              title="No audits run yet"
              description="Run the first health inspection or internal audit to start building the trail."
              action={
                <Link to="/audits/new">
                  <Button size="sm" leftIcon={<IconPlus size={14} />}>
                    New audit
                  </Button>
                </Link>
              }
            />
          ) : null}

          {rows.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Template</th>
                  <th>Score</th>
                  <th>Findings</th>
                  <th>Run date</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {rows.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <div className="cell-stack">
                        <strong>
                          <Link to={`/audits/${run.id}`} className="link">
                            {run.title}
                          </Link>
                        </strong>
                        {run.summary ? (
                          <span className="line-clamp">{run.summary}</span>
                        ) : (
                          <span className="subtle">No summary</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <Badge tone="muted">{run.template.name}</Badge>
                    </td>
                    <td>
                      {typeof run.score === 'number' ? (
                        <strong>{run.score}</strong>
                      ) : (
                        <span className="subtle">—</span>
                      )}
                    </td>
                    <td>{run.findings.length}</td>
                    <td>{new Date(run.runDate).toLocaleDateString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Link to={`/audits/${run.id}`} aria-label={`Open ${run.title}`}>
                        <IconArrowRight size={16} color="var(--color-text-subtle)" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>

        <Card
          title="Templates"
          subtitle="Health Inspection is seeded by default"
          action={
            <Link to="/audits/templates/new">
              <Button size="sm" variant="secondary" leftIcon={<IconPlus size={14} />}>
                New template
              </Button>
            </Link>
          }
        >
          <div className="page-stack compact">
            {templates.loading ? <Spinner label="Loading templates…" /> : null}
            {templates.error ? <ActionFeedback tone="error" message={templates.error} /> : null}
            {(templates.data ?? []).map((template) => (
              <article key={template.id} className="soft-panel" style={{ flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <strong>{template.name}</strong>
                  <Badge tone="muted">{template.sections.length} sections</Badge>
                </div>
                <p className="subtle" style={{ marginTop: 6 }}>
                  {template.sections.slice(0, 3).map((s) => s.title).join(' · ')}
                  {template.sections.length > 3 ? '…' : ''}
                </p>
              </article>
            ))}
            {templates.data && templates.data.length === 0 ? (
              <EmptyState
                icon={<IconAudit size={22} />}
                title="No templates yet"
                description="Create a template to run repeatable audits."
              />
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
