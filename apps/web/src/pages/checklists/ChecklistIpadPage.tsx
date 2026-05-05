import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import type {
  ChecklistItemResult,
  ChecklistRun,
  ChecklistRunItem,
  ChecklistTemplate
} from '@alma/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea
} from '@alma/ui';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { IconArrowLeft, IconCheck, IconChecklist, IconRefresh } from '../../lib/icons';

const VENUE_OPTIONS = [
  { label: 'Alma Avalon', value: 'Alma Avalon' },
  { label: 'St Alma', value: 'St Alma' },
  { label: 'Both venues', value: 'Both' }
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

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase())
    .slice(0, 2)
    .join('');
}

export function ChecklistIpadPage() {
  const { user } = useAuth();
  const templates = useAsync<ChecklistTemplate[]>(() => api('/api/checklists/templates'), []);
  const runs = useAsync<ChecklistRun[]>(() => api('/api/checklists/runs'), []);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [performedBy, setPerformedBy] = useState(
    user ? `${user.firstName} ${user.lastName}`.trim() : ''
  );
  const [venue, setVenue] = useState('Alma Avalon');
  const [currentRun, setCurrentRun] = useState<ChecklistRun | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orderedItems = useMemo(
    () => [...(currentRun?.items ?? [])].sort((a, b) => a.position - b.position),
    [currentRun]
  );

  const doneCount = orderedItems.filter((item) => item.result !== 'PENDING').length;
  const failedCount = orderedItems.filter((item) => item.result === 'FAIL').length;
  const progress = orderedItems.length > 0 ? Math.round((doneCount / orderedItems.length) * 100) : 0;
  const openRuns = useMemo(
    () =>
      [...(runs.data ?? [])]
        .filter((run) => run.status !== 'COMPLETED')
        .filter((run) => venue === 'Both' || run.area === venue || run.area === 'Both')
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 6),
    [runs.data, venue]
  );

  async function startRun(template: ChecklistTemplate) {
    try {
      setStarting(true);
      setError(null);
      const run = await api<ChecklistRun>('/api/checklists/runs', {
        method: 'POST',
        body: JSON.stringify({
          templateId: template.id,
          performedBy,
          area: venue || template.area || '',
          notes: 'Started from iPad checklist view'
        })
      });
      setCurrentRun(run);
      setSelectedTemplateId(template.id);
      setVenue(run.area ?? venue);
      setNotes(
        Object.fromEntries(run.items.map((item) => [item.id, item.notes ?? '']))
      );
      void runs.reload();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start checklist');
    } finally {
      setStarting(false);
    }
  }

  async function updateItem(item: ChecklistRunItem, result: ChecklistItemResult) {
    if (!currentRun) return;

    try {
      setSavingItemId(item.id);
      setError(null);
      await api(`/api/checklists/runs/${currentRun.id}/items/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          result,
          notes: notes[item.id] ?? item.notes ?? '',
          createIssue: result === 'FAIL',
          issueTitle: '',
          issueCategory: 'Checklist Failure',
          issueSeverity: 'MEDIUM'
        })
      });

      const refreshed = await api<ChecklistRun>(`/api/checklists/runs/${currentRun.id}`);
      setCurrentRun(refreshed);
      setNotes(
        Object.fromEntries(refreshed.items.map((runItem) => [runItem.id, runItem.notes ?? '']))
      );
      void runs.reload();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not save checklist item');
    } finally {
      setSavingItemId(null);
    }
  }

  return (
    <div className="ipad-checklist-page">
      <PageHeader
        eyebrow="iPad checklist"
        title={currentRun ? currentRun.template.name : 'Start a staff checklist'}
        description={
          currentRun
            ? `${currentRun.area || currentRun.template.area || 'General'} · ${progress}% complete`
            : 'Large tap targets for staff doing venue checks on an iPad.'
        }
        actions={
          <>
            <Link to="/checklists">
              <Button variant="ghost" size="sm" leftIcon={<IconArrowLeft size={14} />}>
                Back
              </Button>
            </Link>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<IconRefresh size={14} />}
              onClick={() => {
                setCurrentRun(null);
                setError(null);
                void templates.reload();
                void runs.reload();
              }}
            >
              New run
            </Button>
          </>
        }
      />

      {error ? <p className="error-text">{error}</p> : null}

      {!currentRun ? (
        <>
          <Card title="Who is running this?">
            <div className="ipad-run-setup">
              <Input
                label="Staff name"
                value={performedBy}
                onChange={(event) => setPerformedBy(event.target.value)}
                placeholder="Name"
              />
              <Select
                label="Venue"
                value={venue}
                onChange={(event) => setVenue(event.target.value)}
                options={VENUE_OPTIONS}
              />
            </div>
          </Card>

          {openRuns.length > 0 ? (
            <Card title="Continue open checklist" subtitle="Pick up a run that has already started.">
              <div className="ipad-continue-grid">
                {openRuns.map((run) => {
                  const runDone = run.items.filter((item) => item.result !== 'PENDING').length;
                  return (
                    <button
                      key={run.id}
                      type="button"
                      className="ipad-continue-card"
                      onClick={() => {
                        setCurrentRun(run);
                        setSelectedTemplateId(run.templateId);
                        setVenue(run.area ?? venue);
                        setNotes(
                          Object.fromEntries(run.items.map((item) => [item.id, item.notes ?? '']))
                        );
                      }}
                    >
                      <span>
                        <strong>{run.template.name}</strong>
                        <small>
                          {run.area || run.template.area || 'General'} · {runDone}/{run.items.length} done
                        </small>
                      </span>
                      <Badge tone={statusTone(run.status)} dot>
                        {run.status.replace('_', ' ')}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </Card>
          ) : null}

          <Card title="Choose checklist" subtitle="Tap a template to start recording results.">
            {templates.loading ? <Spinner label="Loading checklists…" /> : null}
            {templates.error ? <p className="error-text">{templates.error}</p> : null}
            {!templates.loading && !templates.error && (templates.data ?? []).length === 0 ? (
              <EmptyState
                icon={<IconChecklist size={24} />}
                title="No checklists available"
                description="Ask a manager to create checklist templates first."
              />
            ) : null}
            <div className="ipad-template-grid">
              {(templates.data ?? []).map((template) => (
                <button
                  key={template.id}
                  className={`ipad-template-card ${
                    selectedTemplateId === template.id ? 'selected' : ''
                  }`}
                  type="button"
                  disabled={starting}
                  onClick={() => void startRun(template)}
                >
                  <span className="ipad-template-icon">
                    {initials(template.area || template.name)}
                  </span>
                  <span>
                    <strong>{template.name}</strong>
                    <small>
                      {template.area || 'General'} · {template.items.length}{' '}
                      {template.items.length === 1 ? 'item' : 'items'}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </Card>
        </>
      ) : (
        <>
          <Card padding="none">
            <div className="ipad-run-summary">
              <div>
                <span className="eyebrow">Progress</span>
                <strong>{doneCount}/{orderedItems.length}</strong>
              </div>
              <div>
                <span className="eyebrow">Status</span>
                <Badge tone={statusTone(currentRun.status)} dot>
                  {currentRun.status.replace('_', ' ')}
                </Badge>
              </div>
              <div>
                <span className="eyebrow">Failures</span>
                <strong className={failedCount > 0 ? 'danger-text' : ''}>{failedCount}</strong>
              </div>
            </div>
            <div className="ipad-progress-bar" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
          </Card>

          <div className="ipad-checklist-items">
            {orderedItems.map((item) => (
              <article key={item.id} className="ipad-checklist-item">
                <div className="ipad-checklist-item-copy">
                  <Badge tone={resultTone(item.result)} dot>
                    {item.result === 'NA' ? 'N/A' : item.result}
                  </Badge>
                  <h2>
                    {item.position + 1}. {item.label}
                  </h2>
                  {item.description ? <p>{item.description}</p> : null}
                  {item.linkedIssue ? (
                    <Link className="link" to={`/issues/${item.linkedIssue.id}`}>
                      Issue created: {item.linkedIssue.title}
                    </Link>
                  ) : null}
                </div>

                <div className="ipad-result-buttons">
                  <Button
                    className="ipad-result-button"
                    leftIcon={<IconCheck size={18} />}
                    disabled={savingItemId === item.id}
                    onClick={() => void updateItem(item, 'PASS')}
                  >
                    Pass
                  </Button>
                  <Button
                    className="ipad-result-button"
                    variant="secondary"
                    disabled={savingItemId === item.id}
                    onClick={() => void updateItem(item, 'FAIL')}
                  >
                    Fail
                  </Button>
                  <Button
                    className="ipad-result-button"
                    variant="ghost"
                    disabled={savingItemId === item.id}
                    onClick={() => void updateItem(item, 'NA')}
                  >
                    N/A
                  </Button>
                </div>

                <Textarea
                  label="Notes"
                  value={notes[item.id] ?? item.notes ?? ''}
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [item.id]: event.target.value }))
                  }
                  rows={2}
                  placeholder="Add notes before tapping Pass, Fail, or N/A."
                />
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
