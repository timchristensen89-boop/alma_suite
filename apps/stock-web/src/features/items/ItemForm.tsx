import { useMemo, useState } from 'react';
import type {
  StockCategory,
  StockItem,
  StockItemCreateInput,
  StockItemStatus,
  StockItemUpdateInput
} from '@alma/shared';
import { Button, Input, Select } from '@alma/ui';
import { ApiError, api } from '../../lib/api';

type Mode = 'create' | 'edit';

type Props = {
  mode: Mode;
  categories: StockCategory[];
  initial?: StockItem;
  onSaved: (item: StockItem) => void;
  onCategoryCreated: (category: StockCategory) => void;
  onCancel: () => void;
};

type Draft = {
  name: string;
  sku: string;
  categoryId: string;
  unit: string;
  parLevel: string;
  reorderPoint: string;
  status: StockItemStatus;
  notes: string;
};

const STATUS_OPTIONS: Array<{ label: string; value: StockItemStatus }> = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Archived', value: 'ARCHIVED' }
];

const UNIT_SUGGESTIONS = ['ea', 'kg', 'g', 'L', 'mL', 'carton', 'bottle', 'case'];

function emptyDraft(): Draft {
  return {
    name: '',
    sku: '',
    categoryId: '',
    unit: 'ea',
    parLevel: '0',
    reorderPoint: '',
    status: 'ACTIVE',
    notes: ''
  };
}

function draftFromItem(item: StockItem): Draft {
  return {
    name: item.name,
    sku: item.sku ?? '',
    categoryId: item.categoryId ?? '',
    unit: item.unit,
    parLevel: String(item.parLevel),
    reorderPoint: item.reorderPoint === null ? '' : String(item.reorderPoint),
    status: item.status,
    notes: item.notes ?? ''
  };
}

/**
 * Inline item form used on the Items page for create + edit.
 *
 * Lives inside an existing Card wrapper so it doesn't need its own chrome.
 * In create mode it POSTs to /api/items; in edit mode it PATCHes
 * /api/items/:id. The "Add category" helper is only exposed in create mode —
 * editing is a narrow, single-concern action and we don't want category
 * management hidden in an edit screen.
 */
export function ItemForm({
  mode,
  categories,
  initial,
  onSaved,
  onCategoryCreated,
  onCancel
}: Props) {
  const [draft, setDraft] = useState<Draft>(() =>
    mode === 'edit' && initial ? draftFromItem(initial) : emptyDraft()
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newCategoryName, setNewCategoryName] = useState('');
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const categoryOptions = useMemo(
    () => [
      { label: 'Uncategorised', value: '' },
      ...categories.map((c) => ({ label: c.name, value: c.id }))
    ],
    [categories]
  );

  async function handleCreateCategory() {
    const trimmed = newCategoryName.trim();
    if (trimmed.length < 2) {
      setCategoryError('Name must be at least 2 characters');
      return;
    }
    setCreatingCategory(true);
    setCategoryError(null);
    try {
      const created = await api<StockCategory>('/api/items/categories', {
        method: 'POST',
        body: JSON.stringify({ name: trimmed })
      });
      onCategoryCreated(created);
      update('categoryId', created.id);
      setNewCategoryName('');
    } catch (err) {
      setCategoryError(err instanceof ApiError ? err.message : 'Could not add category');
    } finally {
      setCreatingCategory(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    if (!draft.name.trim()) {
      setError('Item name is required');
      return;
    }
    if (!draft.unit.trim()) {
      setError('Unit is required');
      return;
    }

    const payload: StockItemCreateInput = {
      name: draft.name.trim(),
      sku: draft.sku.trim(),
      categoryId: draft.categoryId,
      unit: draft.unit.trim(),
      parLevel: Number(draft.parLevel || 0),
      reorderPoint: draft.reorderPoint === '' ? undefined : Number(draft.reorderPoint),
      status: draft.status,
      notes: draft.notes.trim()
    };

    setSubmitting(true);
    try {
      if (mode === 'edit' && initial) {
        // PATCH accepts a partial payload; we send the full draft because the
        // form always has every field populated and the server is happy to
        // accept the whole shape.
        const updatePayload: StockItemUpdateInput = payload;
        const saved = await api<StockItem>(`/api/items/${initial.id}`, {
          method: 'PATCH',
          body: JSON.stringify(updatePayload)
        });
        onSaved(saved);
      } else {
        const created = await api<StockItem>('/api/items', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        onSaved(created);
        setDraft(emptyDraft());
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : mode === 'edit'
            ? 'Could not save changes'
            : 'Could not create item'
      );
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = submitting
    ? mode === 'edit'
      ? 'Saving…'
      : 'Creating…'
    : mode === 'edit'
      ? 'Save changes'
      : 'Create item';

  return (
    <form
      className="new-item-form"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <div className="form-grid two">
        <Input
          label="Name"
          required
          value={draft.name}
          onChange={(event) => update('name', event.currentTarget.value)}
          placeholder="e.g. House red wine"
        />
        <Input
          label="SKU"
          value={draft.sku}
          onChange={(event) => update('sku', event.currentTarget.value)}
          placeholder="Optional"
        />
      </div>

      <div className="form-grid three">
        <Select
          label="Category"
          value={draft.categoryId}
          onChange={(event) => update('categoryId', event.currentTarget.value)}
          options={categoryOptions}
        />
        <Input
          label="Unit"
          required
          value={draft.unit}
          onChange={(event) => update('unit', event.currentTarget.value)}
          list="stock-unit-suggestions"
          placeholder="ea, kg, L…"
        />
        <Select
          label="Status"
          value={draft.status}
          onChange={(event) => update('status', event.currentTarget.value as StockItemStatus)}
          options={STATUS_OPTIONS}
        />
        <datalist id="stock-unit-suggestions">
          {UNIT_SUGGESTIONS.map((unit) => (
            <option key={unit} value={unit} />
          ))}
        </datalist>
      </div>

      <div className="form-grid two">
        <Input
          label="Par level"
          type="number"
          step="0.01"
          value={draft.parLevel}
          onChange={(event) => update('parLevel', event.currentTarget.value)}
        />
        <Input
          label="Reorder point"
          type="number"
          step="0.01"
          value={draft.reorderPoint}
          onChange={(event) => update('reorderPoint', event.currentTarget.value)}
          placeholder="Optional"
        />
      </div>

      {mode === 'create' ? (
        <div className="new-item-inline-category">
          <Input
            label="Add new category"
            value={newCategoryName}
            onChange={(event) => setNewCategoryName(event.currentTarget.value)}
            placeholder="Type a new category name"
            hint={categoryError ?? 'Optional — creates a category you can pick above.'}
          />
          <Button
            type="button"
            variant="ghost"
            disabled={creatingCategory || newCategoryName.trim().length < 2}
            onClick={() => void handleCreateCategory()}
          >
            {creatingCategory ? 'Adding…' : 'Add category'}
          </Button>
        </div>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      <div className="toolbar-right">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
