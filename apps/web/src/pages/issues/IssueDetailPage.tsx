import { Link, useParams } from 'react-router-dom';
import type { Issue, IssueAssigneeOption } from '@alma/shared';
import { useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
  Spinner,
  Textarea
} from '@alma/ui';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { IssueSeverityPill } from '../../features/issues/IssueSeverityPill';
import { IssueStatusPill } from '../../features/issues/IssueStatusPill';
import {
  IconArrowLeft,
  IconCheck,
  IconEdit,
  IconExternalLink,
  IconInbox,
  IconRefresh
} from '../../lib/icons';

function escalateAssigneeOptions(assignees: IssueAssigneeOption[]) {
  return [
    { label: 'Keep current assignee', value: '' },
    ...assignees.map((assignee) => ({ label: assignee.label, value: assignee.id }))
  ];
}

export function IssueDetailPage() {
  const { id = '' } = useParams();
  const [completionOpen, setCompletionOpen] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [escalating, setEscalating] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateAssignee, setEscalateAssignee] = useState('');
  const [escalateMonitor, setEscalateMonitor] = useState(false);
  const [escalateNote, setEscalateNote] = useState('');
  const [escalateError, setEscalateError] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync<Issue>(
    () => api(`/api/issues/${id}`),
    [id]
  );
  const assignees = useAsync<IssueAssigneeOption[]>(
    () => api('/api/issues/assignees'),
    []
  );

  const canComplete = data ? data.status !== 'CLOSED' : false;

  async function completeIssue() {
    try {
      setCompleting(true);
      setCompletionError(null);
      await api<Issue>(`/api/issues/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ resolutionNotes })
      });
      setCompletionOpen(false);
      setResolutionNotes('');
      await reload();
    } catch (error) {
      setCompletionError(error instanceof Error ? error.message : 'Failed to complete issue');
    } finally {
      setCompleting(false);
    }
  }

  function openEscalate() {
    setEscalateAssignee('');
    setEscalateMonitor(false);
    setEscalateNote('');
    setEscalateError(null);
    setEscalateOpen(true);
  }

  async function escalate() {
    if (!id) return;
    try {
      setEscalating(true);
      setEscalateError(null);
      const body: { assignee?: string; status?: 'MONITORING'; note?: string } = {};
      if (escalateAssignee.trim()) body.assignee = escalateAssignee.trim();
      if (escalateMonitor) body.status = 'MONITORING';
      if (escalateNote.trim()) body.note = escalateNote.trim();
      await api<Issue>(`/api/issues/${id}/escalate`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      setEscalateOpen(false);
      await reload();
    } catch (error) {
      setEscalateError(
        error instanceof Error ? error.message : 'Failed to escalate issue'
      );
    } finally {
      setEscalating(false);
    }
  }

  if (loading) {
    return (
      <Card title="Loading issue">
        <Spinner label="Loading issue…" />
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card
        title="Issue unavailable"
        action={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<IconRefresh size={14} />}
            onClick={() => void reload()}
          >
            Retry
          </Button>
        }
      >
        <p className="error-text">{error ?? 'Issue not found'}</p>
      </Card>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Issue detail"
        title={data.title}
        description={data.category}
        actions={
          <>
            <Link to="/issues">
              <Button variant="ghost" size="sm" leftIcon={<IconArrowLeft size={14} />}>
                Back
              </Button>
            </Link>
            <Link to={`/issues/${data.id}/edit`}>
              <Button size="sm" leftIcon={<IconEdit size={14} />}>
                Edit
              </Button>
            </Link>
            {(() => {
              const isOverdue = data.dueDate && new Date(data.dueDate).getTime() < Date.now() &&
                data.status !== 'RESOLVED' && data.status !== 'CLOSED';
              const escalationCount = data.activities.filter((a) => a.action === 'escalated').length;
              if (!isOverdue) return null;
              return (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={escalating}
                  onClick={openEscalate}
                >
                  {escalating ? 'Escalating…' : `Escalate${escalationCount > 0 ? ` (L${escalationCount + 1})` : ''}`}
                </Button>
              );
            })()}
            {canComplete ? (
              <Button
                size="sm"
                leftIcon={<IconCheck size={14} />}
                onClick={() => setCompletionOpen((open) => !open)}
              >
                Complete
              </Button>
            ) : null}
          </>
        }
      />

      {completionOpen && canComplete ? (
        <Card
          title="Complete issue"
          subtitle="Close this issue once the follow-up has been handled."
          action={
            <Button
              size="sm"
              leftIcon={<IconCheck size={14} />}
              disabled={completing}
              onClick={() => void completeIssue()}
            >
              {completing ? 'Completing...' : 'Complete issue'}
            </Button>
          }
        >
          <Textarea
            label="Resolution notes"
            value={resolutionNotes}
            onChange={(event) => setResolutionNotes(event.target.value)}
            rows={4}
            placeholder="What was done, who checked it, and any final follow-up."
          />
          {completionError ? <p className="error-text">{completionError}</p> : null}
        </Card>
      ) : null}

      {escalateOpen ? (
        <Card
          title="Escalate or hand off"
          subtitle="Pick who should pick this up next, and add any context."
          action={
            <div className="inline-actions">
              <Button
                variant="ghost"
                size="sm"
                disabled={escalating}
                onClick={() => setEscalateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={escalating}
                onClick={() => void escalate()}
              >
                {escalating ? 'Escalating…' : 'Escalate'}
              </Button>
            </div>
          }
        >
          <div className="page-stack compact">
            <Select
              label="Hand it to"
              value={escalateAssignee}
              onChange={(event) => setEscalateAssignee(event.target.value)}
              options={escalateAssigneeOptions(assignees.data ?? [])}
              disabled={assignees.loading}
              hint={
                assignees.loading
                  ? 'Loading active staff…'
                  : assignees.error
                    ? `Could not load staff: ${assignees.error}`
                    : 'They’ll be reassigned and notified.'
              }
            />
            <label className="field-checkbox">
              <input
                type="checkbox"
                checked={escalateMonitor}
                onChange={(event) => setEscalateMonitor(event.target.checked)}
              />
              <span>Ask them to monitor (pass back to staff)</span>
            </label>
            <Textarea
              label="Note (optional)"
              value={escalateNote}
              onChange={(event) => setEscalateNote(event.target.value)}
              rows={3}
              placeholder="Add context for whoever picks this up."
            />
            {escalateError ? <p className="error-text">{escalateError}</p> : null}
          </div>
        </Card>
      ) : null}

      <div className="grid two-one">
        <Card title="Description">
          <p style={{ color: 'var(--color-text)', lineHeight: 1.6 }}>
            {data.description}
          </p>
        </Card>
        <Card title="Core details">
          <div className="detail-list">
            <div>
              <span>Status</span>
              <IssueStatusPill status={data.status} />
            </div>
            <div>
              <span>Severity</span>
              <IssueSeverityPill severity={data.severity} />
            </div>
            <div>
              <span>Category</span>
              <strong>{data.category}</strong>
            </div>
            <div>
              <span>Area</span>
              <strong>{data.area || 'Not set'}</strong>
            </div>
            <div>
              <span>Assignee</span>
              <strong>{data.assignee || 'Unassigned'}</strong>
            </div>
            <div>
              <span>Due date</span>
              <strong>
                {data.dueDate
                  ? new Date(data.dueDate).toLocaleDateString()
                  : 'None'}
              </strong>
            </div>
            <div>
              <span>Updated</span>
              <strong>{new Date(data.updatedAt).toLocaleString()}</strong>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid two">
        <Card title="Notes">
          <p style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            {data.notes || 'No notes yet.'}
          </p>
        </Card>
        <Card title="Resolution notes">
          <p style={{ color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
            {data.resolutionNotes || 'No resolution notes yet.'}
          </p>
        </Card>
      </div>

      <Card title="Evidence">
        {data.evidence.length === 0 ? (
          <EmptyState
            icon={<IconInbox size={22} />}
            title="No evidence attached"
            description="Link photos, documents, or follow-up URLs from the edit screen."
          />
        ) : (
          <div className="evidence-list">
            {data.evidence.map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="evidence-card"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <IconExternalLink size={14} color="var(--color-text-subtle)" />
                  <strong>{item.name}</strong>
                </div>
                {item.note ? (
                  <span className="evidence-note">{item.note}</span>
                ) : null}
                <span>{item.fileType || 'link'}</span>
              </a>
            ))}
          </div>
        )}
      </Card>

      <Card title="Activity log" subtitle={`${data.activities.length} events`}>
        {data.activities.length === 0 ? (
          <EmptyState
            icon={<IconInbox size={22} />}
            title="No activity yet"
            description="Edits, status changes, and comments will show up here."
          />
        ) : (
          <div className="activity-list">
            {data.activities.map((item) => (
              <article key={item.id} className="activity-row">
                <div>
                  <strong>{item.action}</strong>
                  <p>{item.message}</p>
                </div>
                <span className="subtle">
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
