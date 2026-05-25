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

  // Build per-template 8-week score trend (most recent 8 weeks, oldest left)
  const trendByTemplate = (() => {
    const now = new Date();
    const eightWeeksAgo = new Date(now);
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 8 * 7);
    const buckets = new Map<string, Array<{ templateName: string; week: string; score: number | null; runCount: number }>>();
    // Build empty 8-week skeleton per known template
    const templateNames = new Map<string, string>();
    for (const run of rows) {
      if (typeof run.score !== 'number') continue;
      templateNames.set(run.template.id, run.template.name);
    }
    for (const [templateId, name] of templateNames) {
      const weeks: Array<{ templateName: string; week: string; score: number | null; runCount: number }> = [];
      for (let i = 7; i >= 0; i -= 1) {
        const weekStart = new Date(now);
        weekStart.setDate(weekStart.getDate() - 7 * i);
        weekStart.setHours(0, 0, 0, 0);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1));
        weeks.push({ templateName: name, week: weekStart.toISOString().slice(0, 10), score: null, runCount: 0 });
      }
      buckets.set(templateId, weeks);
    }
    // Fold runs into the buckets
    for (const run of rows) {
      if (typeof run.score !== 'number') continue;
      const runDate = new Date(run.runDate);
      if (runDate < eightWeeksAgo) continue;
      const weekStart = new Date(runDate);
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1));
      const key = weekStart.toISOString().slice(0, 10);
      const bucket = buckets.get(run.template.id);
      if (!bucket) continue;
      const week = bucket.find((w) => w.week === key);
      if (!week) continue;
      const totalScore = (week.score ?? 0) * week.runCount + run.score;
      week.runCount += 1;
      week.score = totalScore / week.runCount;
    }
    return Array.from(buckets.entries()).map(([id, weeks]) => ({
      id,
      name: templateNames.get(id)!,
      weeks
    }));
  })();

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

      {trendByTemplate.length > 0 ? (
        <Card title="Score trend" subtitle="8-week rolling average per template — higher is better">
          <div className="audit-trend-grid">
            {trendByTemplate.map((template) => {
              const scores = template.weeks.map((w) => w.score).filter((s): s is number => typeof s === 'number');
              const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
              const max = Math.max(100, ...scores);
              const last = template.weeks[template.weeks.length - 1]?.score;
              const prev = template.weeks.slice(0, -1).reverse().find((w) => w.score !== null)?.score;
              const delta = last !== null && last !== undefined && prev !== null && prev !== undefined ? last - prev : null;
              const trendTone = delta == null ? 'neutral' : delta >= 2 ? 'positive' : delta <= -2 ? 'danger' : 'warning';
              return (
                <div key={template.id} className="audit-trend-card">
                  <div className="audit-trend-head">
                    <strong>{template.name}</strong>
                    <span className="audit-trend-avg">
                      {avg !== null ? `${avg.toFixed(0)} avg` : 'No data'}
                      {delta !== null ? (
                        <span className={`audit-trend-delta is-${trendTone}`}>
                          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="audit-trend-bars" aria-label={`${template.name} 8 week trend`}>
                    {template.weeks.map((w) => {
                      const height = w.score !== null ? Math.max(6, (w.score / max) * 100) : 4;
                      const barTone = w.score === null ? 'muted' : w.score >= 85 ? 'positive' : w.score >= 70 ? 'warning' : 'danger';
                      return (
                        <div key={w.week} className={`audit-trend-bar is-${barTone}`} title={`${new Date(w.week).toLocaleDateString()}: ${w.score !== null ? w.score.toFixed(0) : 'no audit'}`}>
                          <div className="audit-trend-bar-fill" style={{ height: `${height}%` }} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

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
