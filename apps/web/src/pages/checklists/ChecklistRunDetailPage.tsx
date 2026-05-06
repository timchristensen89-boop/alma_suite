import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import type { ChecklistItemResult, ChecklistRun } from '@alma/shared';
import {
  ActionFeedback,
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
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { IconArrowLeft, IconCheck } from '../../lib/icons';

const resultOptions = [
  { label: 'Pending', value: 'PENDING' },
  { label: 'Pass', value: 'PASS' },
  { label: 'Fail', value: 'FAIL' },
  { label: 'N/A', value: 'NA' }
];

function resultTone(result: ChecklistItemResult) {
  if (result === 'PASS') return 'positive' as const;
  if (result === 'FAIL') return 'danger' as const;
  if (result === 'NA') return 'muted' as const;
  return 'neutral' as const;
}

function statusTone(status: ChecklistRun['status']) {
  if (status === 'COMPLETED') return 'positive' as const;
  if (status === 'IN_PROGRESS') return 'info' as const;
  return 'warning' as const;
}

export function ChecklistRunDetailPage() {
  const { id = '' } = useParams();
  const { data, loading, error, reload } = useAsync<ChecklistRun>(
    () => api(`/api/checklists/runs/${id}`),
    [id]
  );
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [issueTitles, setIssueTitles] = useState<Record<string, string>>({});
  const [itemFeedback, setItemFeedback] = useState<Record<string, { message: string; tone: 'success' | 'error' }>>({});

  async function updateItem(itemId: string, result: ChecklistItemResult) {
    try {
      setSavingItemId(itemId);
      setItemFeedback((current) => ({ ...current, [itemId]: { message: '', tone: 'success' } }));
      await api(`/api/checklists/runs/${id}/items/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify({
          result,
          notes: itemNotes[itemId] ?? '',
          createIssue: result === 'FAIL',
          issueTitle: issueTitles[itemId] ?? '',
          issueCategory: 'Checklist Failure',
          issueSeverity: 'MEDIUM'
        })
      });
      await reload();
      setItemFeedback((current) => ({ ...current, [itemId]: { message: 'Checklist item saved.', tone: 'success' } }));
    } catch (err) {
      setItemFeedback((current) => ({
        ...current,
        [itemId]: { message: err instanceof Error ? err.message : 'Could not save checklist item.', tone: 'error' }
      }));
    } finally {
      setSavingItemId(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <Spinner label="Loading checklist run…" />
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <EmptyState
          title="Checklist unavailable"
          description={error ?? 'Run not found'}
          action={
            <Link to="/checklists">
              <Button variant="ghost" leftIcon={<IconArrowLeft size={14} />}>
                Back to checklists
              </Button>
            </Link>
          }
        />
      </Card>
    );
  }

  const totalItems = data.items.length;
  const done = data.items.filter((item) => item.result !== 'PENDING').length;
  const passed = data.items.filter((item) => item.result === 'PASS').length;
  const failed = data.items.filter((item) => item.result === 'FAIL').length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Checklist run"
        title={data.template.name}
        description={`${data.area || data.template.area || 'General'} · ${new Date(
          data.runDate
        ).toLocaleString()}`}
        actions={
          <Link to="/checklists">
            <Button variant="ghost" size="sm" leftIcon={<IconArrowLeft size={14} />}>
              Back to checklists
            </Button>
          </Link>
        }
      />

      <div className="stats-grid">
        <StatCard
          label="Status"
          value={data.status.replace('_', ' ')}
          tone={statusTone(data.status)}
        />
        <StatCard label="Progress" value={`${done}/${totalItems}`} />
        <StatCard label="Passed" value={passed} tone={passed > 0 ? 'positive' : 'neutral'} />
        <StatCard label="Failed" value={failed} tone={failed > 0 ? 'danger' : 'neutral'} />
      </div>

      <div className="grid two-one">
        <Card title="Run notes">
          <p>{data.notes || 'No notes yet.'}</p>
        </Card>
        <Card title="Assignment">
          <div className="detail-list">
            <div>
              <span>Assigned to</span>
              <strong>{data.performedBy || 'Unassigned'}</strong>
            </div>
            <div>
              <span>Started</span>
              <strong>{new Date(data.createdAt).toLocaleString()}</strong>
            </div>
            <div>
              <span>Last update</span>
              <strong>{new Date(data.updatedAt).toLocaleString()}</strong>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="Checklist items"
        subtitle="Mark each check. A failure creates a linked issue you can chase up."
      >
        <div className="page-stack compact">
          {data.items.map((item) => (
            <article key={item.id} className="checklist-item-card">
              <div className="checklist-item-top">
                <div>
                  <div className="inline-actions" style={{ gap: 8, marginBottom: 4 }}>
                    <Badge tone={resultTone(item.result)} dot>
                      {item.result === 'NA' ? 'N/A' : item.result}
                    </Badge>
                    <strong>
                      {item.position + 1}. {item.label}
                    </strong>
                  </div>
                  <p className="muted">{item.description || 'No guidance.'}</p>
                </div>
                <div className="result-select">
                  <Select
                    label="Result"
                    value={item.result}
                    onChange={(event) =>
                      void updateItem(item.id, event.target.value as ChecklistItemResult)
                    }
                    options={resultOptions}
                  />
                </div>
              </div>
              <div className="form-grid two">
                <Textarea
                  label="Item notes"
                  value={itemNotes[item.id] ?? item.notes ?? ''}
                  onChange={(event) =>
                    setItemNotes((current) => ({ ...current, [item.id]: event.target.value }))
                  }
                  rows={3}
                />
                <Input
                  label="Issue title if failed"
                  value={issueTitles[item.id] ?? item.linkedIssue?.title ?? ''}
                  onChange={(event) =>
                    setIssueTitles((current) => ({
                      ...current,
                      [item.id]: event.target.value
                    }))
                  }
                />
              </div>
              <div className="inline-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<IconCheck size={14} />}
                  onClick={() => void updateItem(item.id, item.result)}
                  disabled={savingItemId === item.id}
                >
                  Save notes
                </Button>
                <ActionFeedback
                  message={itemFeedback[item.id]?.message}
                  tone={itemFeedback[item.id]?.tone}
                />
                {item.linkedIssue ? (
                  <Link to={`/issues/${item.linkedIssue.id}`}>
                    <Button variant="ghost" size="sm">
                      Open linked issue
                    </Button>
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}
