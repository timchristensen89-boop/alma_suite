import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import type { Issue } from '@alma/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Spinner
} from '@alma/ui';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { IssueSeverityPill } from '../../features/issues/IssueSeverityPill';
import { IssueStatusPill } from '../../features/issues/IssueStatusPill';
import {
  IconArrowRight,
  IconIssues,
  IconPlus,
  IconRefresh
} from '../../lib/icons';

const statusOptions = [
  { label: 'All statuses', value: '' },
  { label: 'Open', value: 'OPEN' },
  { label: 'On it', value: 'IN_PROGRESS' },
  { label: 'Partial', value: 'PARTIAL' },
  { label: 'Monitoring', value: 'MONITORING' },
  { label: 'Blocked', value: 'BLOCKED' },
  { label: 'Resolved', value: 'RESOLVED' },
  { label: 'Closed', value: 'CLOSED' }
];

const severityOptions = [
  { label: 'All severities', value: '' },
  { label: 'Low', value: 'LOW' },
  { label: 'Medium', value: 'MEDIUM' },
  { label: 'High', value: 'HIGH' },
  { label: 'Critical', value: 'CRITICAL' }
];

export function IssuesListPage() {
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (severity) params.set('severity', severity);
    if (search) params.set('search', search);
    return params.toString();
  }, [status, severity, search]);

  const { data, loading, error, reload } = useAsync<Issue[]>(
    () => api(`/api/issues${query ? `?${query}` : ''}`),
    [query]
  );

  const filtersActive = Boolean(status || severity || search);
  const resultCount = data?.length ?? 0;

  function clearFilters() {
    setStatus('');
    setSeverity('');
    setSearch('');
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Issues"
        title="Track incidents, hazards, and follow-through"
        description="Every open safety and compliance loop on the floor, with clear ownership and a visible due date."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<IconRefresh size={14} />}
              onClick={() => void reload()}
            >
              Refresh
            </Button>
            <Link to="/issues/new">
              <Button leftIcon={<IconPlus size={14} />}>New issue</Button>
            </Link>
          </>
        }
      />

      <Card
        title="Filters"
        subtitle="Narrow down to the issues that need attention today"
        action={
          filtersActive ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null
        }
      >
        <div className="form-grid three">
          <Select
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={statusOptions}
          />
          <Select
            label="Severity"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            options={severityOptions}
          />
          <Input
            label="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Title, category, description, assignee"
          />
        </div>
      </Card>

      {error ? (
        <Card
          title="Could not load issues"
          action={
            <Button size="sm" variant="secondary" onClick={() => void reload()}>
              Retry
            </Button>
          }
        >
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      <Card padding="none">
        <div className="table-toolbar">
          <span>
            {loading ? (
              <Spinner label="Loading issues…" />
            ) : (
              <>
                <strong style={{ color: 'var(--color-text)' }}>
                  {resultCount}
                </strong>{' '}
                {resultCount === 1 ? 'issue' : 'issues'}
                {filtersActive ? ' matching filters' : ' tracked'}
              </>
            )}
          </span>
          <div className="table-toolbar-right">
            {filtersActive ? (
              <Badge tone="indigo" dot>
                Filters on
              </Badge>
            ) : null}
          </div>
        </div>

        {!loading && !error && resultCount === 0 ? (
          <EmptyState
            icon={<IconIssues size={22} />}
            title={filtersActive ? 'No issues match these filters' : 'No issues yet'}
            description={
              filtersActive
                ? 'Try clearing a filter or broadening your search.'
                : 'Create the first issue to start the compliance trail.'
            }
            action={
              filtersActive ? (
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Link to="/issues/new">
                  <Button size="sm" leftIcon={<IconPlus size={14} />}>
                    Create issue
                  </Button>
                </Link>
              )
            }
          />
        ) : null}

        {!error && resultCount > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>Due</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {data?.map((issue) => (
                <tr key={issue.id}>
                  <td>
                    <div className="cell-stack">
                      <strong>
                        <Link to={`/issues/${issue.id}`} className="link">
                          {issue.title}
                        </Link>
                      </strong>
                      <span className="line-clamp">{issue.description}</span>
                    </div>
                  </td>
                  <td>
                    <Badge tone="muted">{issue.category}</Badge>
                  </td>
                  <td>
                    <IssueSeverityPill severity={issue.severity} />
                  </td>
                  <td>
                    <IssueStatusPill status={issue.status} />
                  </td>
                  <td>{issue.assignee || <span className="subtle">Unassigned</span>}</td>
                  <td>
                    {issue.dueDate ? (() => {
                      const due = new Date(issue.dueDate);
                      const isOverdue = due.getTime() < Date.now() &&
                        issue.status !== 'RESOLVED' && issue.status !== 'CLOSED';
                      const daysOverdue = isOverdue
                        ? Math.floor((Date.now() - due.getTime()) / (1000 * 60 * 60 * 24))
                        : 0;
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {due.toLocaleDateString()}
                          {isOverdue ? (
                            <Badge tone="danger">
                              {daysOverdue === 0 ? 'Overdue today' : `${daysOverdue}d overdue`}
                            </Badge>
                          ) : null}
                        </span>
                      );
                    })() : (
                      <span className="subtle">—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link to={`/issues/${issue.id}`} aria-label={`Open ${issue.title}`}>
                      <IconArrowRight
                        size={16}
                        color="var(--color-text-subtle)"
                      />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}
