import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import type { ChecklistRun, ChecklistTemplate, StaffProfile } from '@alma/shared';
import {
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
import { IconArrowLeft, IconChecklist, IconPlus } from '../../lib/icons';

export function ChecklistRunCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefillTemplate = searchParams.get('template') ?? '';

  const templates = useAsync<ChecklistTemplate[]>(() => api('/api/checklists/templates'), []);
  const staff = useAsync<StaffProfile[]>(() => api('/api/staff'), []);

  const [templateId, setTemplateId] = useState(prefillTemplate);
  const [performedBy, setPerformedBy] = useState('');
  const [area, setArea] = useState('');
  const [notes, setNotes] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Once templates load, default to prefill or first template.
  useEffect(() => {
    if (templates.data && !templateId) {
      if (prefillTemplate && templates.data.some((t) => t.id === prefillTemplate)) {
        setTemplateId(prefillTemplate);
      } else {
        const first = templates.data[0];
        if (first) setTemplateId(first.id);
      }
    }
  }, [templates.data, prefillTemplate, templateId]);

  const templateOptions = useMemo(
    () => [
      { label: 'Select template', value: '' },
      ...((templates.data ?? []).map((template) => ({
        label: `${template.name}${template.area ? ` · ${template.area}` : ''}`,
        value: template.id
      })))
    ],
    [templates.data]
  );

  const staffOptions = useMemo(
    () => [
      { label: 'Unassigned', value: '' },
      ...((staff.data ?? []).map((person) => ({
        label: `${person.firstName} ${person.lastName} · ${person.roleTitle}`,
        value: `${person.firstName} ${person.lastName}`
      })))
    ],
    [staff.data]
  );

  const selectedTemplate = useMemo(
    () => (templates.data ?? []).find((t) => t.id === templateId),
    [templates.data, templateId]
  );

  async function handleCreate() {
    try {
      setSubmitting(true);
      setSubmitError(null);
      const run = await api<ChecklistRun>('/api/checklists/runs', {
        method: 'POST',
        body: JSON.stringify({ templateId, performedBy, area, notes })
      });
      navigate(`/checklists/runs/${run.id}`);
    } catch (createError) {
      setSubmitError(
        createError instanceof Error ? createError.message : 'Failed to create checklist run'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Checklists"
        title="Start a run"
        description="Pick a template, assign it, and start working through the checks."
        actions={
          <Link to="/checklists">
            <Button variant="ghost" size="sm" leftIcon={<IconArrowLeft size={14} />}>
              Back to checklists
            </Button>
          </Link>
        }
      />

      {templates.loading ? (
        <Card>
          <Spinner label="Loading templates…" />
        </Card>
      ) : null}

      {!templates.loading && templates.data?.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconChecklist size={22} />}
            title="No templates yet"
            description="Create a template first — templates are reusable checklists your team can run."
            action={
              <Link to="/checklists/templates/new">
                <Button size="sm" leftIcon={<IconPlus size={14} />}>
                  New template
                </Button>
              </Link>
            }
          />
        </Card>
      ) : null}

      {!templates.loading && (templates.data?.length ?? 0) > 0 ? (
        <Card title="Run details">
          <div className="page-stack compact">
            <Select
              label="Template"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              options={templateOptions}
            />
            <div className="form-grid two">
              <Select
                label="Assign to"
                value={performedBy}
                onChange={(event) => setPerformedBy(event.target.value)}
                options={staffOptions}
              />
              <Input
                label="Area"
                value={area}
                onChange={(event) => setArea(event.target.value)}
                placeholder={selectedTemplate?.area || 'e.g. Kitchen, Bar, Floor'}
              />
            </div>
            <Textarea
              label="Notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder="Anything the person running this should know up front."
            />

            {selectedTemplate ? (
              <div className="soft-panel">
                <p className="eyebrow">Preview — {selectedTemplate.items.length} items</p>
                <ul className="detail-list">
                  {selectedTemplate.items.slice(0, 6).map((item) => (
                    <li key={item.id}>{item.label}</li>
                  ))}
                  {selectedTemplate.items.length > 6 ? (
                    <li className="subtle">
                      +{selectedTemplate.items.length - 6} more…
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {submitError ? <p className="error-text">{submitError}</p> : null}

            <div className="toolbar-right">
              <Button onClick={() => void handleCreate()} disabled={!templateId || submitting}>
                {submitting ? 'Starting…' : 'Start run'}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
