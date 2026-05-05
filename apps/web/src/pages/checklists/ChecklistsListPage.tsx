import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import type { ChecklistRun, ChecklistTemplate } from '@alma/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
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
import {
  IconArrowRight,
  IconChecklist,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconTrash
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

export function ChecklistsListPage() {
  const { user } = useAuth();
  const managerAccess = canManage(user);
  const templates = useAsync<ChecklistTemplate[]>(() => api('/api/checklists/templates'), []);
  const runs = useAsync<ChecklistRun[]>(() => api('/api/checklists/runs'), []);

  const [statusFilter, setStatusFilter] = useState('');
  const [templateFilter, setTemplateFilter] = useState('');
  const [performerFilter, setPerformerFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  async function handleDeleteTemplate(template: ChecklistTemplate) {
    const confirmed = window.confirm(
      `Delete template "${template.name}"? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setDeleteError(null);
      await api(`/api/checklists/templates/${template.id}`, { method: 'DELETE' });
      await templates.reload();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete template');
    }
  }

  const totalRuns = runs.data?.length ?? 0;
  const openRuns = (runs.data ?? []).filter((run) => run.status !== 'COMPLETED').length;
  const last30 = (runs.data ?? []).filter((run) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return new Date(run.runDate).getTime() >= cutoff;
  }).length;
  const totalTemplates = templates.data?.length ?? 0;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Checklists"
        title="Run operational checks and turn failures into issues"
        description="Build reusable templates, assign runs to staff, and keep an auditable history of every check."
        actions={
          <>
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
            {managerAccess ? (
              <Link to="/checklists/templates/new">
                <Button variant="secondary" leftIcon={<IconPlus size={14} />}>
                  New template
                </Button>
              </Link>
            ) : null}
            <Link to="/checklists/ipad">
              <Button variant="secondary" leftIcon={<IconChecklist size={14} />}>
                iPad view
              </Button>
            </Link>
            <Link to="/checklists/new">
              <Button leftIcon={<IconPlus size={14} />}>Start run</Button>
            </Link>
          </>
        }
      />

      <div className="stats-grid">
        <StatCard label="Total runs" value={totalRuns} />
        <StatCard label="Open runs" value={openRuns} tone={openRuns > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Last 30 days" value={last30} />
        <StatCard label="Templates" value={totalTemplates} />
      </div>

      <Card
        title="Templates"
        subtitle="Reusable checks — start a run from a template or edit the items it contains."
        action={
          managerAccess ? (
            <Link to="/checklists/templates/new">
              <Button size="sm" variant="secondary" leftIcon={<IconPlus size={14} />}>
                New template
              </Button>
            </Link>
          ) : null
        }
      >
        {templates.loading ? <Spinner label="Loading templates…" /> : null}
        {templates.error ? <p className="error-text">{templates.error}</p> : null}
        {deleteError ? <p className="error-text">{deleteError}</p> : null}

        {!templates.loading && !templates.error && totalTemplates === 0 ? (
          <EmptyState
            icon={<IconChecklist size={22} />}
            title="No templates yet"
            description="Create your first template so your team can start running checks."
            action={
              managerAccess ? (
              <Link to="/checklists/templates/new">
                <Button size="sm" leftIcon={<IconPlus size={14} />}>
                  Create template
                </Button>
              </Link>
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
                  {managerAccess ? (
                    <div className="template-card-actions">
                      <Link
                        to={`/checklists/templates/${template.id}/edit`}
                        aria-label="Edit template"
                      >
                        <IconButton label="Edit" icon={<IconEdit size={14} />} />
                      </Link>
                      <IconButton
                        label="Delete"
                        icon={<IconTrash size={14} />}
                        onClick={() => void handleDeleteTemplate(template)}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="template-card-meta">
                  <Badge tone="muted">
                    {template.items.length}{' '}
                    {template.items.length === 1 ? 'item' : 'items'}
                  </Badge>
                </div>

                <div className="template-card-footer">
                  <Link to={`/checklists/new?template=${template.id}`}>
                    <Button size="sm" leftIcon={<IconPlus size={12} />}>
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

      <Card padding="none">
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
                : 'Start a run against one of your templates.'
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
          <table>
            <thead>
              <tr>
                <th>Template</th>
                <th>Area</th>
                <th>Performed by</th>
                <th>Run date</th>
                <th>Progress</th>
                <th>Status</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => {
                const done = run.items.filter((item) => item.result !== 'PENDING').length;
                const failed = run.items.filter((item) => item.result === 'FAIL').length;
                return (
                  <tr key={run.id}>
                    <td>
                      <Link to={`/checklists/runs/${run.id}`} className="link">
                        <strong>{run.template.name}</strong>
                      </Link>
                    </td>
                    <td>{run.area || run.template.area || <span className="subtle">—</span>}</td>
                    <td>{run.performedBy || <span className="subtle">Unassigned</span>}</td>
                    <td>{new Date(run.runDate).toLocaleString()}</td>
                    <td>
                      <span>{done}/{run.items.length} done</span>
                      {failed > 0 ? (
                        <span style={{ marginLeft: 8 }}>
                          <Badge tone="danger">{failed} failed</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <Badge tone={statusTone(run.status)} dot>
                        {run.status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link to={`/checklists/runs/${run.id}`} aria-label={`Open ${run.template.name}`}>
                        <IconArrowRight size={16} color="var(--color-text-subtle)" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}
