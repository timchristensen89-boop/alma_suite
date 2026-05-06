import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ChecklistTemplate } from '@alma/shared';
import {
  ActionFeedback,
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  PageHeader,
  Spinner,
  Textarea
} from '@alma/ui';
import { api } from '../../lib/api';
import { IconCheck, IconTrash } from '../../lib/icons';

type ItemDraft = {
  key: string;
  label: string;
  description: string;
};

type TemplateDraft = {
  name: string;
  area: string;
  items: ItemDraft[];
};

function emptyItem(): ItemDraft {
  return {
    key: Math.random().toString(36).slice(2),
    label: '',
    description: ''
  };
}

function emptyDraft(): TemplateDraft {
  return {
    name: '',
    area: '',
    items: [emptyItem(), emptyItem(), emptyItem()]
  };
}

function templateToDraft(template: ChecklistTemplate): TemplateDraft {
  return {
    name: template.name,
    area: template.area ?? '',
    items: template.items
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        key: item.id,
        label: item.label,
        description: item.description ?? ''
      }))
  };
}

export function ChecklistTemplateEditPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [draft, setDraft] = useState<TemplateDraft>(() => emptyDraft());
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isEdit || !id) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const template = await api<ChecklistTemplate>(`/api/checklists/templates/${id}`);
        if (cancelled) return;
        setDraft(templateToDraft(template));
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Could not load template');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isEdit]);

  const canSubmit = useMemo(() => {
    const validItems = draft.items.filter((item) => item.label.trim().length > 0);
    return draft.name.trim().length >= 2 && validItems.length >= 1 && !submitting;
  }, [draft, submitting]);

  function updateItem(key: string, patch: Partial<ItemDraft>) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => (item.key === key ? { ...item, ...patch } : item))
    }));
  }

  function removeItem(key: string) {
    setDraft((current) => ({
      ...current,
      items: current.items.filter((item) => item.key !== key)
    }));
  }

  function addItem() {
    setDraft((current) => ({ ...current, items: [...current.items, emptyItem()] }));
  }

  function moveItem(key: string, delta: -1 | 1) {
    setDraft((current) => {
      const idx = current.items.findIndex((item) => item.key === key);
      if (idx < 0) return current;
      const swapIdx = idx + delta;
      if (swapIdx < 0 || swapIdx >= current.items.length) return current;
      const next = [...current.items];
      const a = next[idx];
      const b = next[swapIdx];
      if (!a || !b) return current;
      next[idx] = b;
      next[swapIdx] = a;
      return { ...current, items: next };
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        area: draft.area.trim(),
        items: draft.items
          .map((item, index) => ({
            label: item.label.trim(),
            description: item.description.trim(),
            position: index
          }))
          .filter((item) => item.label.length > 0)
      };

      if (isEdit && id) {
        await api(`/api/checklists/templates/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await api('/api/checklists/templates', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      navigate('/checklists');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not save template');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <Spinner label="Loading template…" />
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card>
        <EmptyState
          title="Could not load template"
          description={loadError}
          action={<Button variant="ghost" onClick={() => navigate('/checklists')}>Back to checklists</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Checklists"
        title={isEdit ? 'Edit template' : 'New template'}
        description="Set the name, area, and list the checks your team will run against this template."
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate('/checklists')}>Cancel</Button>
            <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create template'}
            </Button>
            <ActionFeedback message={submitError} tone="error" />
          </>
        }
      />

      <Card title="Details">
        <div className="form-grid two">
          <Input
            label="Name"
            value={draft.name}
            onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
            placeholder="e.g. Opening checks — front of house"
          />
          <Input
            label="Area (optional)"
            value={draft.area}
            onChange={(event) => setDraft((d) => ({ ...d, area: event.target.value }))}
            placeholder="e.g. Kitchen, Bar, Floor"
          />
        </div>
      </Card>

      <Card
        title="Items"
        action={<Button variant="secondary" onClick={addItem}>Add item</Button>}
      >
        <div className="page-stack compact">
          {draft.items.length === 0 ? (
            <EmptyState
              icon={<IconCheck size={22} />}
              title="No items yet"
              description="Add at least one check that staff will need to run."
              action={<Button variant="secondary" onClick={addItem}>Add first item</Button>}
            />
          ) : null}

          {draft.items.map((item, index) => (
            <article key={item.key} className="template-item">
              <div className="template-item-header">
                <div className="template-item-header-left">
                  <span className="template-item-index">{index + 1}</span>
                  <span className="template-item-label">Item</span>
                </div>
                <div className="template-item-controls">
                  <IconButton
                    label="Move up"
                    icon={<span aria-hidden="true">↑</span>}
                    onClick={() => moveItem(item.key, -1)}
                    disabled={index === 0}
                  />
                  <IconButton
                    label="Move down"
                    icon={<span aria-hidden="true">↓</span>}
                    onClick={() => moveItem(item.key, 1)}
                    disabled={index === draft.items.length - 1}
                  />
                  <IconButton
                    label="Remove"
                    icon={<IconTrash size={16} />}
                    onClick={() => removeItem(item.key)}
                  />
                </div>
              </div>
              <div className="template-item-body">
                <Input
                  label="Label"
                  value={item.label}
                  onChange={(event) => updateItem(item.key, { label: event.target.value })}
                  placeholder="e.g. Fridge temperature is below 5°C"
                />
                <Textarea
                  label="Guidance (optional)"
                  value={item.description}
                  onChange={(event) => updateItem(item.key, { description: event.target.value })}
                  rows={2}
                  placeholder="Extra guidance shown to staff when they run this check."
                />
              </div>
            </article>
          ))}
        </div>
      </Card>

      {submitError ? <Card><p className="error-text">{submitError}</p></Card> : null}
    </div>
  );
}
