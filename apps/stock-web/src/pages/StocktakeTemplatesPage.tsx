import { FormEvent, useEffect, useMemo, useState } from 'react';
import type {
  StockItem,
  StockItemsPayload,
  StocktakeTemplate,
  StocktakeTemplateInput,
  StocktakeTemplatesPayload
} from '@alma/shared';
import { ActionFeedback, Badge, Button, Card, EmptyState, Input, Select, Spinner } from '@alma/ui';
import { StockItemPicker } from '../components/StockItemPicker';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canManageStock } from '../lib/stockPermissions';
import { confirmDangerousAction } from '../lib/confirmDangerousAction';

const FALLBACK_VENUES = ['Alma Avalon', 'St Alma'];

type Draft = {
  name: string;
  venue: string;
  blindDefault: boolean;
  active: boolean;
  countAreas: string[];
  categoryIds: string[];
  includeItemIds: string[];
  excludeItemIds: string[];
};

function emptyDraft(): Draft {
  return {
    name: '',
    venue: '',
    blindDefault: true,
    active: true,
    countAreas: [],
    categoryIds: [],
    includeItemIds: [],
    excludeItemIds: []
  };
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

export function StocktakeTemplatesPage() {
  useDocumentTitle('Stocktake templates');
  const { user } = useAuth();
  const canManage = canManageStock(user);

  const [data, setData] = useState<StocktakeTemplatesPayload | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  async function load() {
    setLoading(true);
    try {
      const payload = await api<StocktakeTemplatesPayload>('/api/stocktake-templates');
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load stocktake templates.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Stock items power the include/exclude pickers and resolve chip names. Non-fatal.
  useEffect(() => {
    let cancelled = false;
    api<StockItemsPayload>('/api/items')
      .then((payload) => { if (!cancelled) setItems(payload.items ?? []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  const itemsById = useMemo(() => {
    const map = new Map<string, StockItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const categoriesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of data?.categories ?? []) map.set(category.id, category.name);
    return map;
  }, [data]);

  const venueOptions = [
    { label: 'All venues', value: '' },
    ...((data?.venues.length ? data.venues : FALLBACK_VENUES).map((venue) => ({ label: venue, value: venue })))
  ];

  function itemName(id: string) {
    return itemsById.get(id)?.name ?? id;
  }

  function resetForm() {
    setDraft(emptyDraft());
    setEditingId(null);
    setShowForm(false);
  }

  function startCreate() {
    setDraft(emptyDraft());
    setEditingId(null);
    setShowForm(true);
    setFeedback(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function editTemplate(template: StocktakeTemplate) {
    setEditingId(template.id);
    setShowForm(true);
    setFeedback(null);
    setDraft({
      name: template.name,
      venue: template.venue ?? '',
      blindDefault: template.blindDefault,
      active: template.active,
      countAreas: [...template.countAreas],
      categoryIds: [...template.categoryIds],
      includeItemIds: [...template.includeItemIds],
      excludeItemIds: [...template.excludeItemIds]
    });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const baseSummary = useMemo(() => {
    if (!draft.countAreas.length && !draft.categoryIds.length) return 'Base: all active items';
    const parts: string[] = [];
    if (draft.countAreas.length) parts.push(`count areas ${draft.countAreas.join(', ')}`);
    if (draft.categoryIds.length) {
      parts.push(`categories ${draft.categoryIds.map((id) => categoriesById.get(id) ?? id).join(', ')}`);
    }
    return `Base: active items in ${parts.join(' or ')}`;
  }, [draft.countAreas, draft.categoryIds, categoriesById]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) {
      setFeedback({ tone: 'error', message: 'Manager access is required to save templates.' });
      return;
    }
    if (!draft.name.trim()) {
      setFeedback({ tone: 'error', message: 'Give the template a name.' });
      return;
    }
    const body: StocktakeTemplateInput = {
      name: draft.name.trim(),
      venue: draft.venue || '',
      blindDefault: draft.blindDefault,
      countAreas: draft.countAreas,
      categoryIds: draft.categoryIds,
      includeItemIds: draft.includeItemIds,
      excludeItemIds: draft.excludeItemIds,
      active: draft.active
    };
    setSaving(true);
    try {
      if (editingId) {
        await api<StocktakeTemplate>(`/api/stocktake-templates/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body)
        });
      } else {
        await api<StocktakeTemplate>('/api/stocktake-templates', {
          method: 'POST',
          body: JSON.stringify(body)
        });
      }
      setFeedback({ tone: 'success', message: editingId ? 'Template updated.' : 'Template created.' });
      resetForm();
      await load();
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof ApiError ? err.message : 'Could not save template.' });
    } finally {
      setSaving(false);
    }
  }

  async function removeTemplate(template: StocktakeTemplate) {
    if (!canManage) return;
    const confirmed = confirmDangerousAction({
      title: `Delete “${template.name}”`,
      message: 'This removes the template. Stocktakes already started from it are unaffected.',
      confirmationText: 'DELETE'
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      await api<{ id: string }>(`/api/stocktake-templates/${template.id}`, { method: 'DELETE' });
      if (editingId === template.id) resetForm();
      setFeedback({ tone: 'success', message: 'Template deleted.' });
      await load();
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof ApiError ? err.message : 'Could not delete template.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <Card
        title="Stocktake templates"
        subtitle="Reusable count sheets. The base membership is every active item whose count area is one of the chosen areas OR whose category is one of the chosen categories — choose none and the base is all active items. From there, add specific items to always include or exclude."
      >
        <div className="stock-operation-row-actions">
          {canManage ? (
            <Button type="button" onClick={startCreate} disabled={saving}>
              New template
            </Button>
          ) : (
            <p className="subtle">Manager access is required to create or edit templates.</p>
          )}
        </div>
        {feedback && !showForm ? <ActionFeedback message={feedback.message} tone={feedback.tone} /> : null}
      </Card>

      {error ? (
        <Card padding="tight">
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      {showForm ? (
        <Card
          title={editingId ? 'Edit template' : 'New template'}
          subtitle="Pick the base by count area and/or category, then fine-tune with specific items."
        >
          <form className="stock-operation-form" onSubmit={submit}>
            <div className="stock-filter-toolbar">
              <Input
                label="Name"
                value={draft.name}
                onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, name: el.value })); }}
                placeholder="e.g. Bar spirits — weekly"
                required
              />
              <Select
                label="Venue"
                value={draft.venue}
                onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, venue: el.value })); }}
                options={venueOptions}
              />
            </div>

            <div className="template-checks">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.blindDefault}
                  onChange={(event) => { const checked = event.currentTarget.checked; setDraft((current) => ({ ...current, blindDefault: checked })); }}
                />
                Blind by default
              </label>
              {editingId ? (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={draft.active}
                    onChange={(event) => { const checked = event.currentTarget.checked; setDraft((current) => ({ ...current, active: checked })); }}
                  />
                  Active
                </label>
              ) : null}
            </div>

            <div className="template-field">
              <span className="field-label">Count areas</span>
              {data?.countAreas.length ? (
                <div className="template-checks">
                  {data.countAreas.map((area) => (
                    <label key={area} className="check-row">
                      <input
                        type="checkbox"
                        checked={draft.countAreas.includes(area)}
                        onChange={() => setDraft((current) => ({ ...current, countAreas: toggle(current.countAreas, area) }))}
                      />
                      {area}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="subtle">No count areas defined yet.</p>
              )}
            </div>

            <div className="template-field">
              <span className="field-label">Categories</span>
              {data?.categories.length ? (
                <div className="template-checks">
                  {data.categories.map((category) => (
                    <label key={category.id} className="check-row">
                      <input
                        type="checkbox"
                        checked={draft.categoryIds.includes(category.id)}
                        onChange={() => setDraft((current) => ({ ...current, categoryIds: toggle(current.categoryIds, category.id) }))}
                      />
                      {category.name}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="subtle">No categories defined yet.</p>
              )}
            </div>

            <p className="subtle">{baseSummary}</p>

            <div className="template-field">
              <StockItemPicker
                label="Include specific items"
                items={items}
                value=""
                onChange={(id) => { if (id) setDraft((current) => ({ ...current, includeItemIds: current.includeItemIds.includes(id) ? current.includeItemIds : [...current.includeItemIds, id] })); }}
              />
              {draft.includeItemIds.length ? (
                <div className="template-chips">
                  {draft.includeItemIds.map((id) => (
                    <span key={id} className="template-chip">
                      {itemName(id)}
                      <button
                        type="button"
                        className="template-chip-remove"
                        aria-label={`Remove ${itemName(id)}`}
                        onClick={() => setDraft((current) => ({ ...current, includeItemIds: current.includeItemIds.filter((entry) => entry !== id) }))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="template-field">
              <StockItemPicker
                label="Exclude specific items"
                items={items}
                value=""
                onChange={(id) => { if (id) setDraft((current) => ({ ...current, excludeItemIds: current.excludeItemIds.includes(id) ? current.excludeItemIds : [...current.excludeItemIds, id] })); }}
              />
              {draft.excludeItemIds.length ? (
                <div className="template-chips">
                  {draft.excludeItemIds.map((id) => (
                    <span key={id} className="template-chip">
                      {itemName(id)}
                      <button
                        type="button"
                        className="template-chip-remove"
                        aria-label={`Remove ${itemName(id)}`}
                        onClick={() => setDraft((current) => ({ ...current, excludeItemIds: current.excludeItemIds.filter((entry) => entry !== id) }))}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <ActionFeedback message={feedback?.message ?? null} tone={feedback?.tone} />

            <div className="stock-operation-row-actions">
              <Button type="submit" disabled={saving || !canManage}>
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create template'}
              </Button>
              <Button type="button" variant="ghost" disabled={saving} onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title="Templates" subtitle="Reusable count sheets for the group." padding="none">
        {loading ? <Spinner label="Loading templates" /> : null}
        {!loading && !data?.templates.length ? (
          <EmptyState title="No templates yet" description="Create a template to build reusable count sheets." />
        ) : null}
        {data?.templates.length ? (
          <div className="stock-mobile-list">
            {data.templates.map((template) => (
              <div key={template.id} className="stock-operation-row">
                <span>
                  <strong>{template.name}</strong>
                  <span className="subtle">
                    {template.venue ?? 'All venues'} · ≈ {template.resolvedItemCount} item{template.resolvedItemCount === 1 ? '' : 's'}
                  </span>
                  {template.countAreas.length || template.categoryIds.length ? (
                    <span className="template-chips">
                      {template.countAreas.map((area) => (
                        <span key={`area-${area}`} className="template-chip">{area}</span>
                      ))}
                      {template.categoryIds.map((id) => (
                        <span key={`cat-${id}`} className="template-chip">{categoriesById.get(id) ?? id}</span>
                      ))}
                    </span>
                  ) : (
                    <span className="subtle">Base: all active items</span>
                  )}
                </span>
                <span className="stock-operation-row-actions">
                  <Badge tone={template.blindDefault ? 'info' : 'muted'}>
                    {template.blindDefault ? 'Blind' : 'Open'}
                  </Badge>
                  <Badge tone={template.active ? 'positive' : 'muted'}>
                    {template.active ? 'Active' : 'Inactive'}
                  </Badge>
                  {canManage ? (
                    <>
                      <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => editTemplate(template)}>Edit</Button>
                      <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void removeTemplate(template)}>Delete</Button>
                    </>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
