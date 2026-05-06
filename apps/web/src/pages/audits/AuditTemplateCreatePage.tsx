import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import type { AuditTemplate } from '@alma/shared';
import {
  ActionFeedback,
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  PageHeader,
  Textarea
} from '@alma/ui';
import { api } from '../../lib/api';
import {
  IconArrowLeft,
  IconAudit,
  IconPlus,
  IconTrash
} from '../../lib/icons';

type SectionDraft = {
  title: string;
  description: string;
};

function emptySection(): SectionDraft {
  return { title: '', description: '' };
}

export function AuditTemplateCreatePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [sections, setSections] = useState<SectionDraft[]>([emptySection()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateSection(index: number, key: keyof SectionDraft, value: string) {
    setSections((current) =>
      current.map((section, currentIndex) =>
        currentIndex === index ? { ...section, [key]: value } : section
      )
    );
  }

  function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= sections.length) return;
    setSections((current) => {
      const copy = [...current];
      const [moved] = copy.splice(index, 1);
      if (moved) copy.splice(next, 0, moved);
      return copy;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const cleanSections = sections
        .map((section) => ({
          title: section.title.trim(),
          description: section.description.trim()
        }))
        .filter((section) => section.title.length > 0);

      if (cleanSections.length === 0) {
        setError('Add at least one section.');
        setSubmitting(false);
        return;
      }

      await api<AuditTemplate>('/api/audits/templates', {
        method: 'POST',
        body: JSON.stringify({ name, sections: cleanSections })
      });
      navigate('/audits');
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Failed to save template.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  const canSave = name.trim().length >= 2 && sections.some((s) => s.title.trim());

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="page-stack">
      <PageHeader
        eyebrow="New audit template"
        title="Build a reusable audit template"
        description="Templates power audit runs — add the sections you want to walk through every time."
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

      <Card title="Template details">
        <Input
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          placeholder="e.g. Monthly kitchen audit"
        />
      </Card>

      <Card
        title="Sections"
        subtitle="Each section becomes a step in every audit run"
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={<IconPlus size={14} />}
            onClick={() => setSections((current) => [...current, emptySection()])}
          >
            Add section
          </Button>
        }
      >
        {sections.length === 0 ? (
          <EmptyState
            icon={<IconAudit size={22} />}
            title="No sections yet"
            description="Add your first section to get started."
          />
        ) : (
          <div className="page-stack compact">
            {sections.map((section, index) => (
              <article key={index} className="template-item">
                <div className="template-item-header">
                  <div className="template-item-header-left">
                    <span className="template-item-index">{index + 1}</span>
                    <span className="template-item-label">Section</span>
                  </div>
                  <div className="template-item-controls">
                    <IconButton
                      type="button"
                      label="Move up"
                      icon={<span aria-hidden="true">↑</span>}
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                    />
                    <IconButton
                      type="button"
                      label="Move down"
                      icon={<span aria-hidden="true">↓</span>}
                      onClick={() => move(index, 1)}
                      disabled={index === sections.length - 1}
                    />
                    <IconButton
                      type="button"
                      label="Remove"
                      icon={<IconTrash size={14} />}
                      onClick={() =>
                        setSections((current) => current.filter((_, i) => i !== index))
                      }
                    />
                  </div>
                </div>
                <div className="template-item-body">
                  <Input
                    label="Section title"
                    value={section.title}
                    onChange={(event) => updateSection(index, 'title', event.target.value)}
                    required
                    placeholder="e.g. Food Storage & Temperature"
                  />
                  <Textarea
                    label="Description (optional)"
                    value={section.description}
                    onChange={(event) => updateSection(index, 'description', event.target.value)}
                    rows={2}
                    placeholder="What the auditor should look for in this section."
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>

      <div className="toolbar-right">
        <Link to="/audits">
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </Link>
        <Button type="submit" disabled={!canSave || submitting}>
          {submitting ? 'Saving…' : 'Create template'}
        </Button>
        <ActionFeedback message={error} tone="error" />
      </div>
    </form>
  );
}
