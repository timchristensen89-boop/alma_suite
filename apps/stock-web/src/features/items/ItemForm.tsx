import { useEffect, useMemo, useState } from 'react';
import type {
  PrepRecipeLinkOption,
  StockCategory,
  StockItem,
  StockItemCreateInput,
  StockItemStatus,
  StockItemUpdateInput
} from '@alma/shared';
import { isPreparedStockCategory, isWineCategory, splitWineName, withVintage } from '@alma/shared';
import { ActionFeedback, Button, Input, Select } from '@alma/ui';
import { ApiError, api } from '../../lib/api';

type Mode = 'create' | 'edit';

type Props = {
  mode: Mode;
  categories: StockCategory[];
  initial?: StockItem;
  onSaved: (item: StockItem) => void;
  onCategoryCreated: (category: StockCategory) => void;
  canManageCategories?: boolean;
  onCancel: () => void;
};

type Draft = {
  name: string;
  sku: string;
  categoryId: string;
  unit: string;
  countUnit: string;
  conversionFactor: string;
  measurePerCountUnit: string;
  measureUnit: string;
  latestCostDollars: string;
  parLevel: string;
  reorderPoint: string;
  status: StockItemStatus;
  notes: string;
  // Prepared products (Batch Cocktails, Kitchen Prep)
  prepRecipeId: string;
  costPerUnitDollars: string;
};

const STATUS_OPTIONS: Array<{ label: string; value: StockItemStatus }> = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Archived', value: 'ARCHIVED' }
];

const UNIT_SUGGESTIONS = ['ea', 'kg', 'g', 'L', 'mL', 'carton', 'bottle', 'can', 'case'];

function centsToDollars(value: number | null | undefined) {
  return value === null || value === undefined ? '' : (value / 100).toFixed(2);
}

function formatCurrency(value: number | null) {
  if (value === null) return '—';
  return (value / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function emptyDraft(): Draft {
  return {
    name: '',
    sku: '',
    categoryId: '',
    unit: 'ea',
    countUnit: 'ea',
    conversionFactor: '1',
    measurePerCountUnit: '',
    measureUnit: 'g',
    latestCostDollars: '',
    parLevel: '0',
    reorderPoint: '',
    status: 'ACTIVE',
    notes: '',
    prepRecipeId: '',
    costPerUnitDollars: ''
  };
}

function draftFromItem(item: StockItem): Draft {
  return {
    name: item.name,
    sku: item.sku ?? '',
    categoryId: item.categoryId ?? '',
    unit: item.unit,
    countUnit: item.countUnit ?? item.unit,
    conversionFactor: String(item.conversionFactor ?? 1),
    measurePerCountUnit: item.measurePerCountUnit == null ? '' : String(item.measurePerCountUnit),
    measureUnit: item.measureUnit ?? 'g',
    latestCostDollars: centsToDollars(item.latestCostCents),
    parLevel: String(item.parLevel),
    reorderPoint: item.reorderPoint === null ? '' : String(item.reorderPoint),
    status: item.status,
    notes: item.notes ?? '',
    prepRecipeId: item.prepRecipeId ?? '',
    costPerUnitDollars: centsToDollars(item.avgCostCents)
  };
}

// What a prepared product is counted in. Containers are entered on the count
// screen and land as these units.
const PREPARED_COUNT_UNITS = [
  { label: 'litres (L)', value: 'L' },
  { label: 'millilitres (mL)', value: 'mL' },
  { label: 'kilograms (kg)', value: 'kg' },
  { label: 'grams (g)', value: 'g' }
];

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
  canManageCategories = true,
  onCancel
}: Props) {
  const [draft, setDraft] = useState<Draft>(() =>
    mode === 'edit' && initial ? draftFromItem(initial) : emptyDraft()
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error'>('success');

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

  // Vintage is part of the name ("2022 Teusner 'Wark Family' Shiraz"), so a
  // wine gets a field of its own that rewrites the name rather than a column
  // nothing else reads. Every vintage stays its own item.
  const categoryName = categories.find((c) => c.id === draft.categoryId)?.name ?? initial?.category?.name ?? null;
  const isWine = isWineCategory(categoryName);
  const isPrepared = isPreparedStockCategory(categoryName);
  // Moving an item into a prepared section starts it counting in litres;
  // "ea" means nothing for a batch.
  useEffect(() => {
    if (isPrepared && !PREPARED_COUNT_UNITS.some((unit) => unit.value === draft.countUnit) && mode === 'create') {
      setDraft((d) => ({ ...d, countUnit: 'L' }));
    }
  }, [isPrepared, draft.countUnit, mode]);
  const [prepRecipes, setPrepRecipes] = useState<PrepRecipeLinkOption[] | null>(null);
  useEffect(() => {
    if (!isPrepared || prepRecipes) return;
    let cancelled = false;
    api<{ prepRecipes: PrepRecipeLinkOption[] }>('/api/items/prep-recipe-options')
      .then((payload) => { if (!cancelled) setPrepRecipes(payload.prepRecipes); })
      .catch(() => { if (!cancelled) setPrepRecipes([]); });
    return () => { cancelled = true; };
  }, [isPrepared, prepRecipes]);
  const recipeOptions = useMemo(
    () => [
      { label: 'Not linked', value: '' },
      ...(prepRecipes ?? [])
        .filter((recipe) => !recipe.linkedItem || recipe.linkedItem.id === initial?.id)
        .map((recipe) => ({
          label: `${recipe.title}${recipe.venue ? ` — ${recipe.venue}` : ''}${recipe.yieldQuantity ? ` (makes ${recipe.yieldQuantity} ${recipe.yieldUnit ?? ''})` : ''}`,
          value: recipe.id
        }))
    ],
    [prepRecipes, initial?.id]
  );
  const wineParts = isWine ? splitWineName(draft.name) : null;
  const [vintageDraft, setVintageDraft] = useState(() => {
    const parts = splitWineName(mode === 'edit' && initial ? initial.name : '');
    return parts.vintage ? String(parts.vintage) : parts.nonVintage ? 'NV' : '';
  });
  function changeVintage(raw: string) {
    const text = raw.trim().toUpperCase();
    setVintageDraft(raw);
    if (text === '' ) {
      update('name', withVintage(draft.name, null));
    } else if (text === 'NV' || text === 'N.V.') {
      update('name', withVintage(draft.name, 'NV'));
    } else if (/^(19|20)\d\d$/.test(text)) {
      update('name', withVintage(draft.name, Number(text)));
    }
  }

  async function handleCreateCategory() {
    if (!canManageCategories) {
      setCategoryError('Manager access is required to add categories.');
      return;
    }
    const trimmed = newCategoryName.trim();
    if (trimmed.length < 2) {
      setCategoryError('Name must be at least 2 characters');
      return;
    }
    setCreatingCategory(true);
    setCategoryError(null);
    setFeedback(null);
    try {
      const created = await api<StockCategory>('/api/items/categories', {
        method: 'POST',
        body: JSON.stringify({ name: trimmed })
      });
      onCategoryCreated(created);
      update('categoryId', created.id);
      setNewCategoryName('');
      setFeedback('Category added.');
      setFeedbackTone('success');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not add category';
      setCategoryError(message);
      setFeedback(message);
      setFeedbackTone('error');
    } finally {
      setCreatingCategory(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    setFeedback(null);
    if (!draft.name.trim()) {
      setError('Item name is required');
      setFeedback('Item name is required');
      setFeedbackTone('error');
      return;
    }
    if (!draft.unit.trim()) {
      setError('Unit is required');
      setFeedback('Unit is required');
      setFeedbackTone('error');
      return;
    }
    const parLevel = Number(draft.parLevel || 0);
    const conversionFactor = Number(draft.conversionFactor || 1);
    const latestCostDollars =
      draft.latestCostDollars.trim() === '' ? undefined : Number(draft.latestCostDollars);
    const reorderPoint =
      draft.reorderPoint === '' ? undefined : Number(draft.reorderPoint);
    const measurePerCountUnit =
      draft.measurePerCountUnit.trim() === '' ? undefined : Number(draft.measurePerCountUnit);
    if (measurePerCountUnit !== undefined && (!Number.isFinite(measurePerCountUnit) || measurePerCountUnit <= 0)) {
      setError('Measure per count unit must be greater than zero');
      setFeedback('Measure per count unit must be greater than zero');
      setFeedbackTone('error');
      return;
    }
    if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) {
      setError('Units per purchase unit must be greater than zero');
      setFeedback('Units per purchase unit must be greater than zero');
      setFeedbackTone('error');
      return;
    }
    if (latestCostDollars !== undefined && (!Number.isFinite(latestCostDollars) || latestCostDollars < 0)) {
      setError('Latest purchase price cannot be negative');
      setFeedback('Latest purchase price cannot be negative');
      setFeedbackTone('error');
      return;
    }
    if (!Number.isFinite(parLevel) || parLevel < 0) {
      setError('Par level cannot be negative');
      setFeedback('Par level cannot be negative');
      setFeedbackTone('error');
      return;
    }
    if (reorderPoint !== undefined && (!Number.isFinite(reorderPoint) || reorderPoint < 0)) {
      setError('Reorder point cannot be negative');
      setFeedback('Reorder point cannot be negative');
      setFeedbackTone('error');
      return;
    }

    const preparedCost = draft.costPerUnitDollars.trim() === '' ? undefined : Number(draft.costPerUnitDollars);
    if (isPrepared && preparedCost !== undefined && (!Number.isFinite(preparedCost) || preparedCost < 0)) {
      setError('Cost cannot be negative');
      setFeedback('Cost cannot be negative');
      setFeedbackTone('error');
      return;
    }
    const payload: StockItemCreateInput = isPrepared
      ? {
          // A prepared product: counted in L/kg (or mL/g), bought by nobody,
          // kept in a standard container. The container is the purchase unit
          // so "1 container" on the count screen converts to its size.
          name: draft.name.trim(),
          sku: draft.sku.trim(),
          categoryId: draft.categoryId,
          unit: 'container',
          countUnit: draft.countUnit.trim() || 'L',
          conversionFactor,
          prepRecipeId: draft.prepRecipeId,
          ...(preparedCost !== undefined ? { avgCostCents: Math.round(preparedCost * 100) } : {}),
          parLevel,
          reorderPoint,
          status: draft.status,
          notes: draft.notes.trim()
        }
      : {
      name: draft.name.trim(),
      sku: draft.sku.trim(),
      categoryId: draft.categoryId,
      unit: draft.unit.trim(),
      countUnit: draft.countUnit.trim(),
      conversionFactor,
      ...(measurePerCountUnit !== undefined
        ? { measurePerCountUnit, measureUnit: draft.measureUnit === 'ml' ? 'ml' : 'g' }
        : {}),
      latestCostCents:
        latestCostDollars === undefined ? undefined : Math.round(latestCostDollars * 100),
      parLevel,
      reorderPoint,
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
        setFeedback('Item saved.');
        setFeedbackTone('success');
        window.setTimeout(() => onSaved(saved), 450);
      } else {
        const created = await api<StockItem>('/api/items', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        setFeedback('Item created.');
        setFeedbackTone('success');
        window.setTimeout(() => onSaved(created), 450);
        setDraft(emptyDraft());
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : mode === 'edit'
            ? 'Could not save changes'
            : 'Could not create item';
      setError(message);
      setFeedback(message);
      setFeedbackTone('error');
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

  const purchaseCostCents =
    draft.latestCostDollars.trim() === '' ? null : Math.round(Number(draft.latestCostDollars) * 100);
  const conversionFactor = Number(draft.conversionFactor || 1);
  const calculatedUnitCostCents =
    purchaseCostCents !== null && Number.isFinite(purchaseCostCents) && Number.isFinite(conversionFactor) && conversionFactor > 0
      ? Math.round(purchaseCostCents / conversionFactor)
      : initial?.avgCostCents ?? null;
  const countUnit = draft.countUnit.trim() || draft.unit.trim() || 'unit';

  return (
    <form
      className="new-item-form"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <div className={`form-grid ${isWine ? 'three' : 'two'}`}>
        <Input
          label="Name"
          required
          value={draft.name}
          onChange={(event) => update('name', event.currentTarget.value)}
          placeholder="e.g. House red wine"
          hint={wineParts ? `Wine: ${wineParts.wineName}${wineParts.packSuffix ? ' · bought by the case' : ''}` : undefined}
        />
        {isWine ? (
          <Input
            label="Vintage"
            inputMode="numeric"
            value={vintageDraft}
            onChange={(event) => changeVintage(event.currentTarget.value)}
            placeholder="2022 or NV"
            hint="Kept in the name; vintages group together on count sheets."
          />
        ) : null}
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
        {isPrepared ? null : (
          <Input
            label="Purchase unit"
            required
            value={draft.unit}
            onChange={(event) => update('unit', event.currentTarget.value)}
            list="stock-unit-suggestions"
            placeholder="case, kg, L..."
          />
        )}
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

      {isPrepared ? (
        <>
          <div className="form-grid three">
            <Select
              label="Counted in"
              value={draft.countUnit}
              onChange={(event) => update('countUnit', event.currentTarget.value)}
              options={PREPARED_COUNT_UNITS.some((unit) => unit.value === draft.countUnit) ? PREPARED_COUNT_UNITS : [{ label: draft.countUnit || 'L', value: draft.countUnit || 'L' }, ...PREPARED_COUNT_UNITS]}
              hint="Staff can still count in containers or the smaller unit — it is converted for them."
            />
            <Input
              label={`Container size (${countUnit})`}
              type="number"
              step="0.001"
              min="0.001"
              value={draft.conversionFactor}
              onChange={(event) => update('conversionFactor', event.currentTarget.value)}
              hint={`How much one standard container holds, e.g. 5 for a 5 ${countUnit} container.`}
            />
            <Input
              label={`Cost per ${countUnit}`}
              type="number"
              step="0.01"
              min="0"
              value={draft.costPerUnitDollars}
              onChange={(event) => update('costPerUnitDollars', event.currentTarget.value)}
              placeholder="0.00"
              hint={`Value of 1 ${countUnit}. A count of 2.5 ${countUnit} is worth 2.5 × this.`}
            />
          </div>
          <div className="form-grid two">
            <Select
              label="Made from recipe"
              value={draft.prepRecipeId}
              onChange={(event) => update('prepRecipeId', event.currentTarget.value)}
              options={recipeOptions}
              hint="Optional. The recipe suggests the cost; counting this never changes its ingredients' stock."
            />
            <div className="prepared-recipe-cost">
              {initial?.prepRecipe && initial.prepRecipe.id === draft.prepRecipeId ? (
                initial.prepRecipe.costPerCountUnitCents !== null ? (
                  <>
                    <p className="subtle">
                      Recipe cost: <strong>{formatCurrency(initial.prepRecipe.costPerCountUnitCents)} / {countUnit}</strong>
                      {initial.prepRecipe.batchCostCents !== null ? ` (batch ${formatCurrency(initial.prepRecipe.batchCostCents)} for ${initial.prepRecipe.yieldQuantity} ${initial.prepRecipe.yieldUnit})` : ''}
                    </p>
                    {initial.prepRecipe.note ? <p className="subtle">{initial.prepRecipe.note}</p> : null}
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => update('costPerUnitDollars', centsToDollars(initial.prepRecipe!.costPerCountUnitCents))}
                    >
                      Use recipe cost
                    </Button>
                  </>
                ) : (
                  <p className="subtle">{initial.prepRecipe.note}</p>
                )
              ) : draft.prepRecipeId ? (
                <p className="subtle">Save to see what this recipe says one {countUnit} costs.</p>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <>
      <div className="form-grid three">
          <Input
            label="Sale / recipe unit"
            value={draft.countUnit}
            onChange={(event) => update('countUnit', event.currentTarget.value)}
            list="stock-unit-suggestions"
            placeholder="bottle, can, g, mL..."
            hint="The unit recipes and single-sale costs should use."
          />
          <Input
            label="Units per purchase unit"
            type="number"
            step="0.0001"
            min="0.0001"
            value={draft.conversionFactor}
            onChange={(event) => update('conversionFactor', event.currentTarget.value)}
            hint="Example: case of beer = 24 bottles."
          />
          <Input
            label="Latest purchase price"
            type="number"
            step="0.01"
            min="0"
            value={draft.latestCostDollars}
            onChange={(event) => update('latestCostDollars', event.currentTarget.value)}
            placeholder="Optional"
            hint={`Calculated unit cost: ${formatCurrency(calculatedUnitCostCents)} / ${countUnit}`}
          />
        </div>
  
        <div className="form-grid two">
          <Input
            label={`Measure per ${countUnit}`}
            type="number"
            step="0.01"
            min="0"
            value={draft.measurePerCountUnit}
            onChange={(event) => update('measurePerCountUnit', event.currentTarget.value)}
            placeholder="Optional"
            hint={`How much one ${countUnit} weighs or holds — lets g/mL recipes cost this item. e.g. 1 punnet ≈ 250 g.`}
          />
          <Select
            label="Measure unit"
            value={draft.measureUnit}
            onChange={(event) => update('measureUnit', event.currentTarget.value)}
            options={[
              { label: 'grams (g)', value: 'g' },
              { label: 'millilitres (mL)', value: 'ml' }
            ]}
          />
        </div>
  
        {(() => {
          const cu = (draft.countUnit.trim() || draft.unit.trim() || 'unit').toLowerCase();
          const hasMeasure = draft.measurePerCountUnit.trim() !== '' && Number(draft.measurePerCountUnit) > 0;
          const mass = ['mg', 'g', 'kg', 'gram', 'grams', 'kilogram', 'kilo'];
          const vol = ['ml', 'cl', 'dl', 'l', 'litre', 'liter'];
          let usable: string;
          if (mass.includes(cu) || (hasMeasure && draft.measureUnit === 'g')) usable = 'Unit, kg, g';
          else if (vol.includes(cu) || (hasMeasure && draft.measureUnit === 'ml')) usable = 'Unit, L, mL';
          else usable = `Unit only (1 = one whole ${countUnit}) — add a “measure per ${countUnit}” above to also cost g/mL recipe lines`;
          return (
            <p className="subtle" style={{ marginTop: -4 }}>
              Recipe lines can cost this item in: <strong>{usable}</strong>.
            </p>
          );
        })()}
        </>
      )}

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
            hint={
              categoryError ??
              (canManageCategories
                ? 'Optional — creates a category you can pick above.'
                : 'Manager access is required to add categories.')
            }
          />
          <Button
            type="button"
            variant="ghost"
            disabled={
              creatingCategory || newCategoryName.trim().length < 2 || !canManageCategories
            }
            title={canManageCategories ? undefined : 'Manager access required'}
            onClick={() => void handleCreateCategory()}
          >
            {creatingCategory ? 'Adding…' : canManageCategories ? 'Add category' : 'Manager required'}
          </Button>
          <ActionFeedback message={feedback?.includes('Category') || feedback?.includes('category') ? feedback : null} tone={feedbackTone} />
        </div>
      ) : null}

      <div className="toolbar-right">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitLabel}
        </Button>
        <ActionFeedback
          message={feedback && !feedback.toLowerCase().includes('category') ? feedback : null}
          tone={feedbackTone}
        />
      </div>
    </form>
  );
}
