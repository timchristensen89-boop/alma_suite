import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import type { ChecklistRun, ChecklistTemplate } from '@alma/shared';
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
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { canManage } from '../../lib/rbac';
import { SETTINGS_WEB_URL } from '../../config/suiteLinks';
import {
  IconArrowRight,
  IconChecklist,
  IconExternalLink,
  IconPlus,
  IconRefresh
} from '../../lib/icons';

const statusOptions = [
  { label: 'All statuses', value: '' },
  { label: 'Open', value: 'OPEN' },
  { label: 'In progress', value: 'IN_PROGRESS' },
  { label: 'Completed', value: 'COMPLETED' }
];

function statusTone(status: ChecklistRun['status']) {
  if (status === 'COMPLETED') return 'positive' as const;
  if (status === 'IN_PROGRESS') return 'info' as const;
  return 'warning' as const;
}

function adminChecklistTemplatesHref() {
  const base = (SETTINGS_WEB_URL || 'https://alma-suite-admin.web.app').replace(/\/+$/, '');
  return `${base}/checklist-templates`;
}

export function ChecklistsListPage() {
  const { user } = useAuth();
  const managerAccess = canManage(user);
  const templates = useAsync<ChecklistTemplate[]>(() => api('/api/checklists/templates'), []);
  const runs = useAsync<ChecklistRun[]>(() => api('/api/checklists/runs'), []);

  const [statusFilter, setStatusFilter] = useState('');
  const [templateFilter, setTemplateFilter] = useState('');
  const [performerFilter, setPerformerFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  const templateOptions = useMemo(
    () => [
      { label: 'All templates', value: '' },
      ...((templates.data ?? []).map((template) => ({
        label: template.name,
        value: template.id
      })))
    ],
    [templates.data]
  );

  const filteredRuns = useMemo(() => {
    const list = runs.data ?? [];
    return list.filter((run) => {
      if (statusFilter && run.status !== statusFilter) return false;
      if (templateFilter && run.templateId !== templateFilter) return false;
      if (
        performerFilter &&
        !(run.performedBy ?? '').toLowerCase().includes(performerFilter.trim().toLowerCase())
      ) {
        return false;
      }
      if (dateFilter) {
        const runDay = new Date(run.runDate).toISOString().slice(0, 10);
        if (runDay !== dateFilter) return false;
      }
      return true;
    });
  }, [runs.data, statusFilter, templateFilter, performerFilter, dateFilter]);

  const filtersActive = Boolean(statusFilter || templateFilter || performerFilter || dateFilter);

  function clearFilters() {
    setStatusFilter('');
    setTemplateFilter('');
    setPerformerFilter('');
    setDateFilter('');
  }

  const totalRuns = runs.data?.length ?? 0;
  const openRuns = (runs.data ?? []).filter((run) => run.status !== 'COMPLETED').length;
  const last30 = (runs.data ?? []).filter((run) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return new Date(run.runDate).getTime() >= cutoff;
  }).length;
  const totalTemplates = templates.data?.length ?? 0;
  const checklistTemplatesHref = adminChecklistTemplatesHref();

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Checklists"
        title="Daily venue checklists"
        description="Start the right checklist, finish it on a phone or shared iPad, and keep the run history easy to scan."
        actions={
          <>
            <Link to="/checklists/new">
              <Button leftIcon={<IconPlus size={14} />}>Start run</Button>
            </Link>
            <Link to="/checklists/ipad">
              <Button variant="secondary" leftIcon={<IconChecklist size={14} />}>
                iPad view
              </Button>
            </Link>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<IconRefresh size={14} />}
              onClick={() => {
                void templates.reload();
                void runs.reload();
              }}
            >
              Refresh
            </Button>
          </>
        }
      />

      <div className="stats-grid">
        <StatCard label="Total runs" value={totalRuns} />
        <StatCard label="Open runs" value={openRuns} tone={openRuns > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Last 30 days" value={last30} />
        <StatCard label="Templates" value={totalTemplates} />
      </div>

      {managerAccess ? (
        <Card
          title="Checklist admin"
          subtitle="Template setup belongs in Alma Admin. Compliance keeps daily checklist runs and history."
          action={
            <a href={checklistTemplatesHref}>
              <Button size="sm" variant="ghost" rightIcon={<IconExternalLink size={14} />}>
                Admin templates
              </Button>
            </a>
          }
        >
          <div className="checklist-admin-actions">
            <div>
              <strong>Template controls</strong>
              <p className="subtle">
                Create, edit, delete and configure reusable templates in Alma Admin.
              </p>
            </div>
            <a href={checklistTemplatesHref}>
              <Button variant="secondary" leftIcon={<IconPlus size={14} />}>
                Open template setup
              </Button>
            </a>
          </div>
        </Card>
      ) : null}

      <Card
        title="Start from a template"
        subtitle="Pick the checklist that matches the shift or area."
      >
        {templates.loading ? <Spinner label="Loading templates…" /> : null}
        {templates.error ? <p className="error-text">{templates.error}</p> : null}

        {!templates.loading && !templates.error && totalTemplates === 0 ? (
          <EmptyState
            icon={<IconChecklist size={22} />}
            title="No templates yet"
            description="Ask an admin to create templates before staff start daily checks."
            action={
              managerAccess ? (
                <a href={checklistTemplatesHref}>
                  <Button size="sm" leftIcon={<IconPlus size={14} />}>
                    Open Admin templates
                  </Button>
                </a>
              ) : undefined
            }
          />
        ) : null}

        {totalTemplates > 0 ? (
          <div className="template-grid">
            {(templates.data ?? []).map((template) => (
              <article key={template.id} className="template-card">
                <div className="template-card-header">
                  <div className="template-card-title">
                    <strong>{template.name}</strong>
                    <span className="muted">{template.area || 'General'}</span>
                  </div>
                </div>

                <div className="template-card-meta">
                  <Badge tone="muted">
                    {template.items.length}{' '}
                    {template.items.length === 1 ? 'item' : 'items'}
                  </Badge>
                </div>

                <div className="template-card-footer">
                  <Link to={`/checklists/new?template=${template.id}`}>
                    <Button leftIcon={<IconPlus size={14} />}>
                      Start run
                    </Button>
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </Card>

      <Card
        title="Run history"
        subtitle="Every checklist run, who performed it, and how it ended."
        action={
          filtersActive ? (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null
        }
      >
        <div className="form-grid three">
          <Select
            label="Status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            options={statusOptions}
          />
          <Select
            label="Template"
            value={templateFilter}
            onChange={(event) => setTemplateFilter(event.target.value)}
            options={templateOptions}
          />
          <Input
            label="Performed by"
            value={performerFilter}
            onChange={(event) => setPerformerFilter(event.target.value)}
            placeholder="Name contains…"
          />
        </div>
        <div className="form-grid two" style={{ marginTop: 12 }}>
          <Input
            label="Date"
            type="date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
          />
          <div />
        </div>
      </Card>

      <Card>
        <div className="table-toolbar">
          <span>
            {runs.loading ? (
              <Spinner label="Loading runs…" />
            ) : (
              <>
                <strong style={{ color: 'var(--color-text)' }}>{filteredRuns.length}</strong>{' '}
                {filteredRuns.length === 1 ? 'run' : 'runs'}
                {filtersActive ? ' matching filters' : ' on record'}
              </>
            )}
          </span>
          <div className="toolbar-right">
            {filtersActive ? <Badge tone="indigo" dot>Filters on</Badge> : null}
          </div>
        </div>

        {runs.error ? <p className="error-text" style={{ padding: '0 20px 16px' }}>{runs.error}</p> : null}

        {!runs.loading && !runs.error && filteredRuns.length === 0 ? (
          <EmptyState
            icon={<IconChecklist size={22} />}
            title={filtersActive ? 'No runs match these filters' : 'No runs yet'}
            description={
              filtersActive
                ? 'Try clearing a filter or broadening your search.'
                : 'Start a run against one of the templates.'
            }
            action={
              filtersActive ? (
                <Button size="sm" variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Link to="/checklists/new">
                  <Button size="sm" leftIcon={<IconPlus size={14} />}>Start run</Button>
                </Link>
              )
            }
          />
        ) : null}

        {filteredRuns.length > 0 ? (
          <div className="checklist-run-grid">
            {filteredRuns.map((run) => {
              const done = run.items.filter((item) => item.result !== 'PENDING').length;
              const failed = run.items.filter((item) => item.result === 'FAIL').length;
              const percent = run.items.length > 0 ? Math.round((done / run.items.length) * 100) : 0;
              return (
                <article key={run.id} className="checklist-run-card">
                  <div className="checklist-run-card-top">
                    <div>
                      <Link to={`/checklists/runs/${run.id}`} className="link">
                        <strong>{run.template.name}</strong>
                      </Link>
                      <span className="subtle">
                        {run.area || run.template.area || 'General'} · {new Date(run.runDate).toLocaleString()}
                      </span>
                    </div>
                    <Badge tone={statusTone(run.status)} dot>
                      {run.status.replace('_', ' ')}
                    </Badge>
                  </div>
                  <div className="checklist-run-progress">
                    <div>
                      <span>{done}/{run.items.length} done</span>
                      {failed > 0 ? <Badge tone="danger">{failed} failed</Badge> : null}
                    </div>
                    <span className="checklist-progress-track" aria-hidden="true">
                      <span style={{ width: `${percent}%` }} />
                    </span>
                  </div>
                  <div className="checklist-run-card-footer">
                    <span className="subtle">{run.performedBy || 'Unassigned'}</span>
                    <Link to={`/checklists/runs/${run.id}`} aria-label={`Open ${run.template.name}`}>
                      <Button size="sm" variant="secondary" rightIcon={<IconArrowRight size={14} />}>
                        Open
                      </Button>
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
