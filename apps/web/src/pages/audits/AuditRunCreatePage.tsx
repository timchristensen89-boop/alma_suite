import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import type { AuditRun, AuditTemplate } from '@alma/shared';
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
  Textarea
} from '@alma/ui';
import { useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { IconArrowLeft, IconAudit, IconCheck } from '../../lib/icons';

type SectionState = {
  title: string;
  description: string | null;
  note: string;
  score: string;
  createIssue: boolean;
};

export function AuditRunCreatePage() {
  const navigate = useNavigate();
  const templates = useAsync<AuditTemplate[]>(() => api('/api/audits/templates'), []);
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState(
    `Health inspection · ${new Date().toLocaleDateString()}`
  );
  const [summary, setSummary] = useState('');
  const [sections, setSections] = useState<SectionState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Default to Health Inspection template when it arrives
  useEffect(() => {
    if (!templates.data || templateId) return;
    const health = templates.data.find((t) => t.name.toLowerCase().includes('health'));
    const pick = health ?? templates.data[0];
    if (pick) setTemplateId(pick.id);
  }, [templates.data, templateId]);

  const selectedTemplate = useMemo(
    () => templates.data?.find((t) => t.id === templateId) ?? null,
    [templates.data, templateId]
  );

  // When a template is chosen, seed a SectionState per section
  useEffect(() => {
    if (!selectedTemplate) {
      setSections([]);
      return;
    }
    setSections(
      selectedTemplate.sections.map((section) => ({
        title: section.title,
        description: section.description,
        note: '',
        score: '',
        createIssue: false
      }))
    );
  }, [selectedTemplate]);

  const totalScore = useMemo(() => {
    const scored = sections.filter((s) => s.score.trim() !== '');
    if (scored.length === 0) return null;
    const sum = scored.reduce((acc, s) => acc + Number(s.score || 0), 0);
    return Math.round((sum / scored.length) * 10) / 10;
  }, [sections]);

  function updateSection<K extends keyof SectionState>(
    index: number,
    key: K,
    value: SectionState[K]
  ) {
    setSections((current) =>
      current.map((section, currentIndex) =>
        currentIndex === index ? { ...section, [key]: value } : section
      )
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate) return;
    setSubmitting(true);
    setError(null);
    try {
      const findings = sections
        .filter((section) => section.note.trim().length > 0)
        .map((section) => ({
          sectionTitle: section.title,
          finding: section.note.trim(),
          score: section.score ? Number(section.score) : undefined,
          createIssue: section.createIssue
        }));

      const created = await api<AuditRun>('/api/audits/runs', {
        method: 'POST',
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          title,
          summary,
          score: totalScore ?? undefined,
          findings
        })
      });

      navigate(`/audits/${created.id}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Failed to save audit run.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="page-stack">
      <PageHeader
        eyebrow="New audit"
        title="Run an internal audit"
        description="Step through each section, note anything out of compliance, and convert failures into tracked issues."
        actions={
          <Link to="/audits">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leftIcon={<IconArrowLeft size={14} />}
            >
              Back to audits
            </Button>
          </Link>
        }
      />

      <Card title="Audit details">
        {templates.loading ? <Spinner label="Loading templates…" /> : null}
        {templates.error ? <p className="error-text">{templates.error}</p> : null}

        <div className="form-grid two">
          <Select
            label="Template"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            options={[
              { label: 'Select template', value: '' },
              ...((templates.data ?? []).map((t) => ({ label: t.name, value: t.id })))
            ]}
          />
          <Input
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </div>
        <div style={{ marginTop: 16 }}>
          <Textarea
            label="Overall summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={3}
            placeholder="Anything notable about the visit, the area, or overall score?"
          />
        </div>
      </Card>

      {selectedTemplate ? (
        <Card
          title="Sections"
          subtitle={`Template: ${selectedTemplate.name}`}
          action={
            totalScore !== null ? (
              <Badge tone="indigo" dot>
                Running average: {totalScore}
              </Badge>
            ) : null
          }
        >
          <div className="page-stack compact">
            {sections.map((section, index) => (
              <article key={section.title} className="checklist-item-card">
                <div className="checklist-item-top">
                  <div>
                    <strong>
                      {index + 1}. {section.title}
                    </strong>
                    {section.description ? (
                      <p className="muted">{section.description}</p>
                    ) : null}
                  </div>
                  <div className="result-select">
                    <Input
                      label="Score (0–10)"
                      type="number"
                      min={0}
                      max={10}
                      step={0.5}
                      value={section.score}
                      onChange={(event) => updateSection(index, 'score', event.target.value)}
                    />
                  </div>
                </div>
                <Textarea
                  label="Finding / notes"
                  value={section.note}
                  onChange={(event) => updateSection(index, 'note', event.target.value)}
                  rows={3}
                  placeholder="Describe what you saw. Leave blank if there's nothing to flag."
                />
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={section.createIssue}
                    onChange={(event) =>
                      updateSection(index, 'createIssue', event.target.checked)
                    }
                    disabled={section.note.trim().length === 0}
                  />
                  <span>Create a follow-up issue for this finding</span>
                </label>
              </article>
            ))}
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<IconAudit size={22} />}
            title="Pick a template to begin"
            description="The Health Inspection template is seeded by default and covers the standard AU food-premises checks."
          />
        </Card>
      )}

      <div className="toolbar-right">
        <Link to="/audits">
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Link>
        <Button
          type="submit"
          disabled={!selectedTemplate || submitting}
          leftIcon={<IconCheck size={14} />}
        >
          {submitting ? 'Saving…' : 'Save audit'}
        </Button>
        <ActionFeedback message={error} tone="error" />
      </div>
    </form>
  );
}
