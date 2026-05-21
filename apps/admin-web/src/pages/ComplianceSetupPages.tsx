import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AppSettingsPayload, AuditTemplate, ChecklistTemplate } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Spinner, Textarea } from '@alma/ui';
import { api } from '../../../web/src/lib/api';
import { useDocumentTitle } from '../../../web/src/hooks/useDocumentTitle';

type ChecklistItemDraft = {
  key: string;
  label: string;
  description: string;
};

type ChecklistTemplateDraft = {
  name: string;
  area: string;
  items: ChecklistItemDraft[];
};

type AuditSectionDraft = {
  key: string;
  title: string;
  description: string;
};

type AuditTemplateDraft = {
  name: string;
  sections: AuditSectionDraft[];
};

const COMPLIANCE_APP_URL = (
  import.meta.env.VITE_COMPLIANCE_WEB_URL ||
  'https://alma-compliance.web.app'
).replace(/\/+$/, '');

function draftKey() {
  return Math.random().toString(36).slice(2);
}

function emptyChecklistItem(): ChecklistItemDraft {
  return { key: draftKey(), label: '', description: '' };
}

function emptyChecklistDraft(): ChecklistTemplateDraft {
  return { name: '', area: '', items: [emptyChecklistItem()] };
}

function checklistToDraft(template: ChecklistTemplate): ChecklistTemplateDraft {
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

function emptyAuditSection(): AuditSectionDraft {
  return { key: draftKey(), title: '', description: '' };
}

function emptyAuditDraft(): AuditTemplateDraft {
  return { name: '', sections: [emptyAuditSection()] };
}

function auditToDraft(template: AuditTemplate): AuditTemplateDraft {
  return {
    name: template.name,
    sections: template.sections
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((section) => ({
        key: section.id,
        title: section.title,
        description: section.description ?? ''
      }))
  };
}

function moveDraft<T>(items: T[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item) next.splice(nextIndex, 0, item);
  return next;
}

export function ComplianceSettingsPage() {
  useDocumentTitle('Compliance settings · Alma Admin');
  const [settings, setSettings] = useState<AppSettingsPayload | null>(null);
  const [checklists, setChecklists] = useState<ChecklistTemplate[]>([]);
  const [audits, setAudits] = useState<AuditTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [settingsPayload, checklistPayload, auditPayload] = await Promise.all([
          api<AppSettingsPayload>('/api/settings'),
          api<ChecklistTemplate[]>('/api/checklists/templates'),
          api<AuditTemplate[]>('/api/audits/templates')
        ]);
        if (cancelled) return;
        setSettings(settingsPayload);
        setChecklists(checklistPayload);
        setAudits(auditPayload);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load Compliance settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const venues = settings?.venues ?? [];

  return (
    <div className="page-stack">
      <div className="admin-section-heading">
        <p>Compliance setup</p>
        <h2>Compliance settings</h2>
        <span>Admin owns setup. Compliance stays focused on daily checklists, audits, issues, incidents and handbook reading.</span>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {loading ? <Spinner label="Loading Compliance settings" /> : null}

      <div className="admin-grid three">
        <Card title="Checklist templates" subtitle={`${checklists.length} templates configured`}>
          <p className="muted">Create and maintain the checklist templates used by daily Compliance and venue iPad runs.</p>
          <a className="btn secondary" href="/checklist-templates">Open checklist settings</a>
        </Card>
        <Card title="Audit templates" subtitle={`${audits.length} templates configured`}>
          <p className="muted">Create and maintain reusable audit structures for health inspections and internal reviews.</p>
          <a className="btn secondary" href="/audit-templates">Open audit settings</a>
        </Card>
        <Card title="Shift task rules" subtitle="Assign required tasks from roster shifts">
          <p className="muted">Opening, closing, manager and venue-specific shift rules create operational work.</p>
          <a className="btn secondary" href="/shift-task-rules">Open shift task rules</a>
        </Card>
      </div>

      <div className="admin-grid two">
        <Card title="Venue compliance scope" subtitle="Driven by the saved organisation settings">
          {venues.length ? (
            <div className="tag-list">
              {venues.map((venue) => <Badge key={venue.name} tone="muted">{venue.name}</Badge>)}
            </div>
          ) : (
            <EmptyState title="No venues configured" description="Add venues before enabling venue-specific compliance setup." />
          )}
        </Card>
        <Card title="Daily Compliance app" subtitle="Run work outside Admin">
          <div className="admin-boundary-list">
            <div>
              <strong>Checklist runs</strong>
              <span>Staff start and complete checklists in Compliance.</span>
            </div>
            <div>
              <strong>Audit runs and incidents</strong>
              <span>Findings and follow-up work stay in the operational app.</span>
            </div>
          </div>
          <a className="btn ghost" href={COMPLIANCE_APP_URL}>Open Compliance</a>
        </Card>
      </div>
    </div>
  );
}

export function ChecklistTemplatesPage() {
  useDocumentTitle('Checklist templates · Alma Admin');
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [draft, setDraft] = useState<ChecklistTemplateDraft>(() => emptyChecklistDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await api<ChecklistTemplate[]>('/api/checklists/templates'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load checklist templates.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const canSave = useMemo(
    () => draft.name.trim().length >= 2 && draft.items.some((item) => item.label.trim().length > 0) && !saving,
    [draft, saving]
  );

  function editTemplate(template: ChecklistTemplate) {
    setEditingId(template.id);
    setDraft(checklistToDraft(template));
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    setEditingId(null);
    setDraft(emptyChecklistDraft());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFeedback(null);
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
    try {
      await api(editingId ? `/api/checklists/templates/${editingId}` : '/api/checklists/templates', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      setFeedback(editingId ? 'Checklist template updated.' : 'Checklist template created.');
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save checklist template.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(template: ChecklistTemplate) {
    if (!window.confirm(`Delete ${template.name}? Templates with runs cannot be deleted.`)) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await api(`/api/checklists/templates/${template.id}`, { method: 'DELETE' });
      setFeedback('Checklist template deleted.');
      if (editingId === template.id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete checklist template.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="admin-section-heading">
        <p>Checklist settings</p>
        <h2>Checklist templates</h2>
        <span>Maintain the templates staff run in Compliance and on venue iPads.</span>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {feedback ? <div className="success-banner">{feedback}</div> : null}

      <details className="admin-collapsible" open={Boolean(editingId)}>
        <summary>{editingId ? 'Edit checklist template' : 'Create checklist template'}</summary>
        <Card title={editingId ? 'Edit template' : 'New template'} subtitle="Sections are collapsed here by default so the page stays usable.">
          <form className="page-stack compact" onSubmit={submit}>
            <div className="form-grid two">
              <Input
                label="Name"
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="Opening checks - front of house"
                required
              />
              <Input
                label="Area"
                value={draft.area}
                onChange={(event) => setDraft((current) => ({ ...current, area: event.target.value }))}
                placeholder="Kitchen, Bar, Floor"
              />
            </div>
            <div className="page-stack compact">
              {draft.items.map((item, index) => (
                <article key={item.key} className="template-item">
                  <div className="template-item-header">
                    <div className="template-item-header-left">
                      <span className="template-item-index">{index + 1}</span>
                      <span className="template-item-label">Checklist item</span>
                    </div>
                    <div className="template-item-controls">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((current) => ({ ...current, items: moveDraft(current.items, index, -1) }))} disabled={index === 0}>Up</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((current) => ({ ...current, items: moveDraft(current.items, index, 1) }))} disabled={index === draft.items.length - 1}>Down</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((current) => ({ ...current, items: current.items.filter((entry) => entry.key !== item.key) }))}>Remove</Button>
                    </div>
                  </div>
                  <div className="template-item-body">
                    <Input label="Label" value={item.label} onChange={(event) => setDraft((current) => ({ ...current, items: current.items.map((entry) => entry.key === item.key ? { ...entry, label: event.target.value } : entry) }))} />
                    <Textarea label="Guidance" value={item.description} onChange={(event) => setDraft((current) => ({ ...current, items: current.items.map((entry) => entry.key === item.key ? { ...entry, description: event.target.value } : entry) }))} rows={2} />
                  </div>
                </article>
              ))}
            </div>
            <div className="admin-form-actions">
              <Button type="button" variant="secondary" onClick={() => setDraft((current) => ({ ...current, items: [...current.items, emptyChecklistItem()] }))}>Add item</Button>
              <Button type="submit" disabled={!canSave}>{saving ? 'Saving...' : editingId ? 'Save changes' : 'Create template'}</Button>
              {editingId ? <Button type="button" variant="ghost" onClick={resetForm}>Cancel edit</Button> : null}
            </div>
          </form>
        </Card>
      </details>

      {loading ? <Spinner label="Loading checklist templates" /> : null}
      {!loading && !templates.length ? <EmptyState title="No checklist templates" description="Create the first checklist template for daily Compliance work." /> : null}
      <div className="admin-access-grid">
        {templates.map((template) => (
          <article key={template.id} className="admin-access-card">
            <div>
              <strong>{template.name}</strong>
              <small>{template.area || 'No area'} · {template.items.length} items</small>
            </div>
            <Badge tone="muted">{template.area || 'General'}</Badge>
            <p className="muted">{template.items.slice(0, 3).map((item) => item.label).join(', ')}</p>
            <div className="admin-row-actions">
              <Button type="button" variant="secondary" onClick={() => editTemplate(template)}>Edit</Button>
              <Button type="button" variant="ghost" onClick={() => void deleteTemplate(template)} disabled={saving}>Delete</Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function AuditTemplatesPage() {
  useDocumentTitle('Audit templates · Alma Admin');
  const [templates, setTemplates] = useState<AuditTemplate[]>([]);
  const [draft, setDraft] = useState<AuditTemplateDraft>(() => emptyAuditDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await api<AuditTemplate[]>('/api/audits/templates'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load audit templates.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const canSave = useMemo(
    () => draft.name.trim().length >= 2 && draft.sections.some((section) => section.title.trim().length > 0) && !saving,
    [draft, saving]
  );

  function editTemplate(template: AuditTemplate) {
    setEditingId(template.id);
    setDraft(auditToDraft(template));
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    setEditingId(null);
    setDraft(emptyAuditDraft());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFeedback(null);
    const payload = {
      name: draft.name.trim(),
      sections: draft.sections
        .map((section, index) => ({
          title: section.title.trim(),
          description: section.description.trim(),
          position: index
        }))
        .filter((section) => section.title.length > 0)
    };
    try {
      await api(editingId ? `/api/audits/templates/${editingId}` : '/api/audits/templates', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      setFeedback(editingId ? 'Audit template updated.' : 'Audit template created.');
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save audit template.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(template: AuditTemplate) {
    if (!window.confirm(`Delete ${template.name}? Templates with audit runs cannot be deleted.`)) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      await api(`/api/audits/templates/${template.id}`, { method: 'DELETE' });
      setFeedback('Audit template deleted.');
      if (editingId === template.id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete audit template.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="admin-section-heading">
        <p>Audit settings</p>
        <h2>Audit templates</h2>
        <span>Maintain reusable audit structures without crowding the daily audit run flow.</span>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {feedback ? <div className="success-banner">{feedback}</div> : null}

      <details className="admin-collapsible" open={Boolean(editingId)}>
        <summary>{editingId ? 'Edit audit template' : 'Create audit template'}</summary>
        <Card title={editingId ? 'Edit template' : 'New template'} subtitle="Each section becomes a step in every audit run.">
          <form className="page-stack compact" onSubmit={submit}>
            <Input
              label="Name"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="Monthly kitchen audit"
              required
            />
            <div className="page-stack compact">
              {draft.sections.map((section, index) => (
                <article key={section.key} className="template-item">
                  <div className="template-item-header">
                    <div className="template-item-header-left">
                      <span className="template-item-index">{index + 1}</span>
                      <span className="template-item-label">Audit section</span>
                    </div>
                    <div className="template-item-controls">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((current) => ({ ...current, sections: moveDraft(current.sections, index, -1) }))} disabled={index === 0}>Up</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((current) => ({ ...current, sections: moveDraft(current.sections, index, 1) }))} disabled={index === draft.sections.length - 1}>Down</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setDraft((current) => ({ ...current, sections: current.sections.filter((entry) => entry.key !== section.key) }))}>Remove</Button>
                    </div>
                  </div>
                  <div className="template-item-body">
                    <Input label="Section title" value={section.title} onChange={(event) => setDraft((current) => ({ ...current, sections: current.sections.map((entry) => entry.key === section.key ? { ...entry, title: event.target.value } : entry) }))} />
                    <Textarea label="Description" value={section.description} onChange={(event) => setDraft((current) => ({ ...current, sections: current.sections.map((entry) => entry.key === section.key ? { ...entry, description: event.target.value } : entry) }))} rows={2} />
                  </div>
                </article>
              ))}
            </div>
            <div className="admin-form-actions">
              <Button type="button" variant="secondary" onClick={() => setDraft((current) => ({ ...current, sections: [...current.sections, emptyAuditSection()] }))}>Add section</Button>
              <Button type="submit" disabled={!canSave}>{saving ? 'Saving...' : editingId ? 'Save changes' : 'Create template'}</Button>
              {editingId ? <Button type="button" variant="ghost" onClick={resetForm}>Cancel edit</Button> : null}
            </div>
          </form>
        </Card>
      </details>

      {loading ? <Spinner label="Loading audit templates" /> : null}
      {!loading && !templates.length ? <EmptyState title="No audit templates" description="Create the first audit template for repeatable inspections." /> : null}
      <div className="admin-access-grid">
        {templates.map((template) => (
          <article key={template.id} className="admin-access-card">
            <div>
              <strong>{template.name}</strong>
              <small>{template.sections.length} sections</small>
            </div>
            <Badge tone="muted">Audit</Badge>
            <p className="muted">{template.sections.slice(0, 3).map((section) => section.title).join(', ')}</p>
            <div className="admin-row-actions">
              <Button type="button" variant="secondary" onClick={() => editTemplate(template)}>Edit</Button>
              <Button type="button" variant="ghost" onClick={() => void deleteTemplate(template)} disabled={saving}>Delete</Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
