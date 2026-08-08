import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  RecipeCategory,
  RecipeCategoryKind,
  StockCategory,
  StockItemsPayload
} from '@alma/shared';
import {
  ActionFeedback,
  Button,
  Card,
  CollapsibleCard,
  EmptyState,
  Input,
  Select,
  Spinner
} from '@alma/ui';
import { IconItems, IconRecipes } from '../lib/icons';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canManageStock } from '../lib/stockPermissions';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

type StockCategoryDraft = {
  name: string;
  description: string;
};

type UnitAlias = {
  id: string;
  alias: string;
  canonical: string;
  createdAt: string;
  updatedAt: string;
};

type UnitAliasDraft = {
  alias: string;
  canonical: string;
};

type RecipeCategoryDraft = {
  name: string;
  kind: RecipeCategoryKind;
  description: string;
};

const RECIPE_CATEGORY_KIND_OPTIONS: Array<{ label: string; value: RecipeCategoryKind }> = [
  { label: 'Food', value: 'FOOD' },
  { label: 'Beverage', value: 'BEVERAGE' },
  { label: 'Other', value: 'OTHER' }
];

function stockDraftFromCategory(category: StockCategory): StockCategoryDraft {
  return {
    name: category.name,
    description: category.description ?? ''
  };
}

function recipeDraftFromCategory(category: RecipeCategory): RecipeCategoryDraft {
  return {
    name: category.name,
    kind: category.kind,
    description: category.description ?? ''
  };
}

export function SettingsPage({ section }: { section?: 'stock' | 'recipe' | 'units' } = {}) {
  useDocumentTitle(
    section === 'stock'
      ? 'Stock categories'
      : section === 'recipe'
        ? 'Recipe categories'
        : section === 'units'
          ? 'Units'
          : 'Setup'
  );
  const { user } = useAuth();
  const canManage = canManageStock(user);

  const [stockCategories, setStockCategories] = useState<StockCategory[]>([]);
  const [stockItemCounts, setStockItemCounts] = useState<Record<string, number>>({});
  const [stockDrafts, setStockDrafts] = useState<Record<string, StockCategoryDraft>>({});
  const [newStockCategory, setNewStockCategory] = useState<StockCategoryDraft>({
    name: '',
    description: ''
  });

  const [recipeCategories, setRecipeCategories] = useState<RecipeCategory[]>([]);
  const [recipeDrafts, setRecipeDrafts] = useState<Record<string, RecipeCategoryDraft>>({});
  const [newRecipeCategory, setNewRecipeCategory] = useState<RecipeCategoryDraft>({
    name: '',
    kind: 'FOOD',
    description: ''
  });

  const [unitAliases, setUnitAliases] = useState<UnitAlias[]>([]);
  const [unitAliasDrafts, setUnitAliasDrafts] = useState<Record<string, UnitAliasDraft>>({});
  const [newUnitAlias, setNewUnitAlias] = useState<UnitAliasDraft>({ alias: '', canonical: '' });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error'>('success');

  async function loadSettings() {
    setLoading(true);
    try {
      const [itemsPayload, recipeCategoryPayload, unitAliasPayload] = await Promise.all([
        api<StockItemsPayload>('/api/items/picker'),
        api<RecipeCategory[]>('/api/recipes/categories'),
        api<UnitAlias[]>('/api/items/unit-aliases')
      ]);

      const counts: Record<string, number> = {};
      for (const item of itemsPayload.items) {
        if (!item.categoryId) continue;
        counts[item.categoryId] = (counts[item.categoryId] ?? 0) + 1;
      }

      setStockCategories(itemsPayload.categories);
      setStockItemCounts(counts);
      setStockDrafts(
        Object.fromEntries(
          itemsPayload.categories.map((category) => [
            category.id,
            stockDraftFromCategory(category)
          ])
        )
      );

      setRecipeCategories(recipeCategoryPayload);
      setRecipeDrafts(
        Object.fromEntries(
          recipeCategoryPayload.map((category) => [
            category.id,
            recipeDraftFromCategory(category)
          ])
        )
      );

      setUnitAliases(unitAliasPayload);
      setUnitAliasDrafts(
        Object.fromEntries(
          unitAliasPayload.map((row) => [row.id, { alias: row.alias, canonical: row.canonical }])
        )
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  const stockCategoryCount = useMemo(() => stockCategories.length, [stockCategories]);
  const recipeCategoryCount = useMemo(() => recipeCategories.length, [recipeCategories]);

  function updateStockDraft(id: string, patch: Partial<StockCategoryDraft>) {
    setStockDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? { name: '', description: '' }),
        ...patch
      }
    }));
  }

  function updateRecipeDraft(id: string, patch: Partial<RecipeCategoryDraft>) {
    setRecipeDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] ?? { name: '', kind: 'FOOD', description: '' }),
        ...patch
      }
    }));
  }

  async function createStockCategory() {
    if (!canManage) {
      setFeedbackTarget('stock:new');
      setFeedbackMessage('Manager access is required to add stock categories.');
      setFeedbackTone('error');
      return;
    }
    setSavingKey('stock:new');
    setFeedbackTarget('stock:new');
    setFeedbackMessage(null);
    try {
      const created = await api<StockCategory>('/api/items/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: newStockCategory.name.trim(),
          description: newStockCategory.description.trim()
        })
      });
      setStockCategories((current) =>
        [...current, created].sort((a, b) => a.name.localeCompare(b.name))
      );
      setStockDrafts((current) => ({
        ...current,
        [created.id]: stockDraftFromCategory(created)
      }));
      setNewStockCategory({ name: '', description: '' });
      setError(null);
      setFeedbackMessage('Stock category added.');
      setFeedbackTone('success');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not create stock category';
      setError(message);
      setFeedbackMessage(message);
      setFeedbackTone('error');
    } finally {
      setSavingKey(null);
    }
  }

  async function saveStockCategory(category: StockCategory) {
    if (!canManage) {
      setFeedbackTarget(`stock:${category.id}`);
      setFeedbackMessage('Manager access is required to save stock categories.');
      setFeedbackTone('error');
      return;
    }
    const draft = stockDrafts[category.id] ?? stockDraftFromCategory(category);
    setSavingKey(`stock:${category.id}`);
    setFeedbackTarget(`stock:${category.id}`);
    setFeedbackMessage(null);
    try {
      const saved = await api<StockCategory>(`/api/items/categories/${category.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: draft.name.trim(),
          description: draft.description.trim()
        })
      });
      setStockCategories((current) =>
        current
          .map((candidate) => (candidate.id === saved.id ? saved : candidate))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setStockDrafts((current) => ({
        ...current,
        [saved.id]: stockDraftFromCategory(saved)
      }));
      setError(null);
      setFeedbackMessage('Stock category saved.');
      setFeedbackTone('success');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save stock category';
      setError(message);
      setFeedbackMessage(message);
      setFeedbackTone('error');
    } finally {
      setSavingKey(null);
    }
  }

  async function createRecipeCategory() {
    if (!canManage) {
      setFeedbackTarget('recipe:new');
      setFeedbackMessage('Manager access is required to add recipe categories.');
      setFeedbackTone('error');
      return;
    }
    setSavingKey('recipe:new');
    setFeedbackTarget('recipe:new');
    setFeedbackMessage(null);
    try {
      const created = await api<RecipeCategory>('/api/recipes/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: newRecipeCategory.name.trim(),
          kind: newRecipeCategory.kind,
          description: newRecipeCategory.description.trim()
        })
      });
      setRecipeCategories((current) =>
        [...current, created].sort((a, b) => a.name.localeCompare(b.name))
      );
      setRecipeDrafts((current) => ({
        ...current,
        [created.id]: recipeDraftFromCategory(created)
      }));
      setNewRecipeCategory({ name: '', kind: 'FOOD', description: '' });
      setError(null);
      setFeedbackMessage('Recipe category added.');
      setFeedbackTone('success');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not create recipe category';
      setError(message);
      setFeedbackMessage(message);
      setFeedbackTone('error');
    } finally {
      setSavingKey(null);
    }
  }

  async function saveRecipeCategory(category: RecipeCategory) {
    if (!canManage) {
      setFeedbackTarget(`recipe:${category.id}`);
      setFeedbackMessage('Manager access is required to save recipe categories.');
      setFeedbackTone('error');
      return;
    }
    const draft = recipeDrafts[category.id] ?? recipeDraftFromCategory(category);
    setSavingKey(`recipe:${category.id}`);
    setFeedbackTarget(`recipe:${category.id}`);
    setFeedbackMessage(null);
    try {
      const saved = await api<RecipeCategory>(`/api/recipes/categories/${category.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: draft.name.trim(),
          kind: draft.kind,
          description: draft.description.trim()
        })
      });
      setRecipeCategories((current) =>
        current
          .map((candidate) => (candidate.id === saved.id ? saved : candidate))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setRecipeDrafts((current) => ({
        ...current,
        [saved.id]: recipeDraftFromCategory(saved)
      }));
      setError(null);
      setFeedbackMessage('Recipe category saved.');
      setFeedbackTone('success');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save recipe category';
      setError(message);
      setFeedbackMessage(message);
      setFeedbackTone('error');
    } finally {
      setSavingKey(null);
    }
  }

  function sortUnitAliases(rows: UnitAlias[]): UnitAlias[] {
    return [...rows].sort(
      (a, b) => a.canonical.localeCompare(b.canonical) || a.alias.localeCompare(b.alias)
    );
  }

  function updateUnitAliasDraft(id: string, patch: Partial<UnitAliasDraft>) {
    setUnitAliasDrafts((current) => ({
      ...current,
      [id]: { ...(current[id] ?? { alias: '', canonical: '' }), ...patch }
    }));
  }

  async function createUnitAlias() {
    if (!canManage) {
      setFeedbackTarget('unit:new');
      setFeedbackMessage('Manager access is required to add unit aliases.');
      setFeedbackTone('error');
      return;
    }
    setSavingKey('unit:new');
    setFeedbackTarget('unit:new');
    setFeedbackMessage(null);
    try {
      const created = await api<UnitAlias>('/api/items/unit-aliases', {
        method: 'POST',
        body: JSON.stringify({
          alias: newUnitAlias.alias.trim(),
          canonical: newUnitAlias.canonical.trim()
        })
      });
      setUnitAliases((current) => sortUnitAliases([...current, created]));
      setUnitAliasDrafts((current) => ({
        ...current,
        [created.id]: { alias: created.alias, canonical: created.canonical }
      }));
      setNewUnitAlias({ alias: '', canonical: '' });
      setError(null);
      setFeedbackMessage('Unit alias added.');
      setFeedbackTone('success');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not add the unit alias';
      setError(message);
      setFeedbackMessage(message);
      setFeedbackTone('error');
    } finally {
      setSavingKey(null);
    }
  }

  async function saveUnitAlias(row: UnitAlias) {
    if (!canManage) {
      setFeedbackTarget(`unit:${row.id}`);
      setFeedbackMessage('Manager access is required to save unit aliases.');
      setFeedbackTone('error');
      return;
    }
    const draft = unitAliasDrafts[row.id] ?? { alias: row.alias, canonical: row.canonical };
    setSavingKey(`unit:${row.id}`);
    setFeedbackTarget(`unit:${row.id}`);
    setFeedbackMessage(null);
    try {
      const saved = await api<UnitAlias>(`/api/items/unit-aliases/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          alias: draft.alias.trim(),
          canonical: draft.canonical.trim()
        })
      });
      setUnitAliases((current) =>
        sortUnitAliases(current.map((candidate) => (candidate.id === saved.id ? saved : candidate)))
      );
      setUnitAliasDrafts((current) => ({
        ...current,
        [saved.id]: { alias: saved.alias, canonical: saved.canonical }
      }));
      setError(null);
      setFeedbackMessage('Unit alias saved.');
      setFeedbackTone('success');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save the unit alias';
      setError(message);
      setFeedbackMessage(message);
      setFeedbackTone('error');
    } finally {
      setSavingKey(null);
    }
  }

  async function deleteUnitAlias(row: UnitAlias) {
    if (!canManage) {
      setFeedbackTarget(`unit:${row.id}`);
      setFeedbackMessage('Manager access is required to delete unit aliases.');
      setFeedbackTone('error');
      return;
    }
    setSavingKey(`unit:${row.id}`);
    setFeedbackTarget(`unit:${row.id}`);
    setFeedbackMessage(null);
    try {
      await api(`/api/items/unit-aliases/${row.id}`, { method: 'DELETE' });
      setUnitAliases((current) => current.filter((candidate) => candidate.id !== row.id));
      setError(null);
      setFeedbackMessage(null);
      setFeedbackTarget(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not delete the unit alias';
      setError(message);
      setFeedbackMessage(message);
      setFeedbackTone('error');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="page-stack">
      {section === undefined ? (
        <Card
          title="Setup"
          subtitle="Category management now lives next to where it's used. Daily stock health, low-stock work, item edits and stocktake review stay in the operational Stock pages."
        >
          <p className="subtle" style={{ marginBottom: 10 }}>
            Manage categories from their hub:
          </p>
          <div className="toolbar-right" style={{ justifyContent: 'flex-start', gap: 10 }}>
            <Link className="btn btn-ghost btn-sm" to="/items/categories">
              Stock categories →
            </Link>
            <Link className="btn btn-ghost btn-sm" to="/recipes/categories">
              Recipe categories →
            </Link>
            <Link className="btn btn-ghost btn-sm" to="/items/units">
              Units &amp; aliases →
            </Link>
          </div>
        </Card>
      ) : null}

      {error && !feedbackTarget ? <p className="error-text">{error}</p> : null}

      {section === 'stock' ? (
      <CollapsibleCard
        title="Stock categories"
        description="Used by items, stocktake locations, and catalogue grouping."
        badge={loading ? 'Loading' : `${stockCategoryCount} categories`}
      >
        {loading ? (
          <Spinner label="Loading stock categories" />
        ) : stockCategories.length === 0 ? (
          <EmptyState
            icon={<IconItems size={24} />}
            title="No stock categories yet"
            description="Add the first category here, then assign items to it from the Items page."
          />
        ) : null}

        {!loading ? (
          <div className="settings-category-stack">
            <div className="settings-category-row settings-category-row-create">
              <Input
                id="new-stock-category-name"
                label="New category"
                value={newStockCategory.name}
                onChange={(event) => {
                  const el = event.currentTarget;
                  setNewStockCategory((current) => ({
                    ...current,
                    name: el.value
                  }));
                }}
                placeholder="e.g. Spirits"
              />
              <Input
                id="new-stock-category-description"
                label="Description"
                value={newStockCategory.description}
                onChange={(event) => {
                  const el = event.currentTarget;
                  setNewStockCategory((current) => ({
                    ...current,
                    description: el.value
                  }));
                }}
                placeholder="Optional"
              />
              <span className="settings-category-count">New</span>
              <Button
                type="button"
                onClick={() => void createStockCategory()}
                disabled={
                  savingKey === 'stock:new' ||
                  newStockCategory.name.trim().length < 2 ||
                  !canManage
                }
                title={canManage ? undefined : 'Manager access required'}
              >
                {savingKey === 'stock:new'
                  ? 'Adding...'
                  : canManage
                    ? 'Add'
                    : 'Manager required'}
              </Button>
              <ActionFeedback
                message={feedbackTarget === 'stock:new' ? feedbackMessage : null}
                tone={feedbackTone}
              />
            </div>

            {stockCategories.map((category) => {
              const draft = stockDrafts[category.id] ?? stockDraftFromCategory(category);
              return (
                <div key={category.id} className="settings-category-row">
                  <Input
                    id={`stock-category-name-${category.id}`}
                    label="Name"
                    value={draft.name}
                    onChange={(event) =>
                      updateStockDraft(category.id, { name: event.currentTarget.value })
                    }
                  />
                  <Input
                    id={`stock-category-description-${category.id}`}
                    label="Description"
                    value={draft.description}
                    onChange={(event) =>
                      updateStockDraft(category.id, {
                        description: event.currentTarget.value
                      })
                    }
                    placeholder="Optional"
                  />
                  <span className="settings-category-count">
                    {stockItemCounts[category.id] ?? 0} items
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void saveStockCategory(category)}
                    disabled={
                      savingKey === `stock:${category.id}` ||
                      draft.name.trim().length < 2 ||
                      !canManage
                    }
                    title={canManage ? undefined : 'Manager access required'}
                  >
                    {savingKey === `stock:${category.id}`
                      ? 'Saving...'
                      : canManage
                        ? 'Save'
                        : 'Manager required'}
                  </Button>
                  <ActionFeedback
                    message={feedbackTarget === `stock:${category.id}` ? feedbackMessage : null}
                    tone={feedbackTone}
                  />
                </div>
              );
            })}
          </div>
        ) : null}
      </CollapsibleCard>
      ) : null}

      {section === 'recipe' ? (
      <CollapsibleCard
        title="Recipe categories"
        description="Controls the recipe category dropdown and renames existing recipe category values."
        badge={loading ? 'Loading' : `${recipeCategoryCount} categories`}
      >
        {loading ? (
          <Spinner label="Loading recipe categories" />
        ) : recipeCategories.length === 0 ? (
          <EmptyState
            icon={<IconRecipes size={24} />}
            title="No recipe categories yet"
            description="Add food or beverage recipe categories here before creating recipes."
          />
        ) : null}

        {!loading ? (
          <div className="settings-category-stack">
            <div className="settings-category-row settings-category-row-create settings-category-row-recipe">
              <Input
                id="new-recipe-category-name"
                label="New category"
                value={newRecipeCategory.name}
                onChange={(event) => {
                  const el = event.currentTarget;
                  setNewRecipeCategory((current) => ({
                    ...current,
                    name: el.value
                  }));
                }}
                placeholder="e.g. Cocktails"
              />
              <Select
                id="new-recipe-category-kind"
                label="Type"
                value={newRecipeCategory.kind}
                onChange={(event) => {
                  const el = event.currentTarget;
                  setNewRecipeCategory((current) => ({
                    ...current,
                    kind: el.value as RecipeCategoryKind
                  }));
                }}
                options={RECIPE_CATEGORY_KIND_OPTIONS}
              />
              <Input
                id="new-recipe-category-description"
                label="Description"
                value={newRecipeCategory.description}
                onChange={(event) => {
                  const el = event.currentTarget;
                  setNewRecipeCategory((current) => ({
                    ...current,
                    description: el.value
                  }));
                }}
                placeholder="Optional"
              />
              <span className="settings-category-count">New</span>
              <Button
                type="button"
                onClick={() => void createRecipeCategory()}
                disabled={
                  savingKey === 'recipe:new' ||
                  newRecipeCategory.name.trim().length < 2 ||
                  !canManage
                }
                title={canManage ? undefined : 'Manager access required'}
              >
                {savingKey === 'recipe:new'
                  ? 'Adding...'
                  : canManage
                    ? 'Add'
                    : 'Manager required'}
              </Button>
              <ActionFeedback
                message={feedbackTarget === 'recipe:new' ? feedbackMessage : null}
                tone={feedbackTone}
              />
            </div>

            {recipeCategories.map((category) => {
              const draft = recipeDrafts[category.id] ?? recipeDraftFromCategory(category);
              return (
                <div
                  key={category.id}
                  className="settings-category-row settings-category-row-recipe"
                >
                  <Input
                    id={`recipe-category-name-${category.id}`}
                    label="Name"
                    value={draft.name}
                    onChange={(event) =>
                      updateRecipeDraft(category.id, { name: event.currentTarget.value })
                    }
                  />
                  <Select
                    id={`recipe-category-kind-${category.id}`}
                    label="Type"
                    value={draft.kind}
                    onChange={(event) =>
                      updateRecipeDraft(category.id, {
                        kind: event.currentTarget.value as RecipeCategoryKind
                      })
                    }
                    options={RECIPE_CATEGORY_KIND_OPTIONS}
                  />
                  <Input
                    id={`recipe-category-description-${category.id}`}
                    label="Description"
                    value={draft.description}
                    onChange={(event) =>
                      updateRecipeDraft(category.id, {
                        description: event.currentTarget.value
                      })
                    }
                    placeholder="Optional"
                  />
                  <span className="settings-category-count">
                    {category.recipeCount} recipes
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void saveRecipeCategory(category)}
                    disabled={
                      savingKey === `recipe:${category.id}` ||
                      draft.name.trim().length < 2 ||
                      !canManage
                    }
                    title={canManage ? undefined : 'Manager access required'}
                  >
                    {savingKey === `recipe:${category.id}`
                      ? 'Saving...'
                      : canManage
                        ? 'Save'
                        : 'Manager required'}
                  </Button>
                  <ActionFeedback
                    message={feedbackTarget === `recipe:${category.id}` ? feedbackMessage : null}
                    tone={feedbackTone}
                  />
                </div>
              );
            })}
          </div>
        ) : null}
      </CollapsibleCard>
      ) : null}

      {section === 'units' ? (
      <CollapsibleCard
        title="Unit aliases"
        description={
          'Different spellings of the same unit — "KILO" means kg, "Unit" means each, "Btl" means bottle. ' +
          'Stocktakes (including Loaded imports), invoices and recipes all read units through this list, so a ' +
          'count in "KILO" values correctly against an item counted in kg. Pack sizes with a number, like ' +
          '"700ml" or "750 mL" against an item counted in bottles, are recognised automatically — the quantity ' +
          'counts the containers, so no alias is needed.'
        }
        badge={loading ? 'Loading' : `${unitAliases.length} aliases`}
      >
        {loading ? (
          <Spinner label="Loading unit aliases" />
        ) : unitAliases.length === 0 ? (
          <EmptyState
            icon={<IconItems size={24} />}
            title="No unit aliases yet"
            description="Add the first alias here — e.g. KILO means kg — and every stocktake and invoice will read it that way."
          />
        ) : null}

        {!loading ? (
          <div className="settings-category-stack">
            <div className="settings-category-row settings-category-row-units settings-category-row-create">
              <Input
                id="new-unit-alias"
                label="When a count says"
                value={newUnitAlias.alias}
                onChange={(event) => {
                  const el = event.currentTarget;
                  setNewUnitAlias((current) => ({ ...current, alias: el.value }));
                }}
                placeholder="e.g. KILO"
              />
              <Input
                id="new-unit-alias-canonical"
                label="It means"
                value={newUnitAlias.canonical}
                onChange={(event) => {
                  const el = event.currentTarget;
                  setNewUnitAlias((current) => ({ ...current, canonical: el.value }));
                }}
                placeholder="e.g. kg"
              />
              <span className="settings-category-count">New</span>
              <Button
                type="button"
                onClick={() => void createUnitAlias()}
                disabled={
                  savingKey === 'unit:new' ||
                  newUnitAlias.alias.trim().length < 1 ||
                  newUnitAlias.canonical.trim().length < 1 ||
                  !canManage
                }
                title={canManage ? undefined : 'Manager access required'}
              >
                {savingKey === 'unit:new' ? 'Adding...' : canManage ? 'Add' : 'Manager required'}
              </Button>
              <ActionFeedback
                message={feedbackTarget === 'unit:new' ? feedbackMessage : null}
                tone={feedbackTone}
              />
            </div>

            {unitAliases.map((row) => {
              const draft = unitAliasDrafts[row.id] ?? { alias: row.alias, canonical: row.canonical };
              return (
                <div key={row.id} className="settings-category-row settings-category-row-units">
                  <Input
                    id={`unit-alias-${row.id}`}
                    label="When a count says"
                    value={draft.alias}
                    onChange={(event) =>
                      updateUnitAliasDraft(row.id, { alias: event.currentTarget.value })
                    }
                  />
                  <Input
                    id={`unit-alias-canonical-${row.id}`}
                    label="It means"
                    value={draft.canonical}
                    onChange={(event) =>
                      updateUnitAliasDraft(row.id, { canonical: event.currentTarget.value })
                    }
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void saveUnitAlias(row)}
                    disabled={
                      savingKey === `unit:${row.id}` ||
                      draft.alias.trim().length < 1 ||
                      draft.canonical.trim().length < 1 ||
                      !canManage
                    }
                    title={canManage ? undefined : 'Manager access required'}
                  >
                    {savingKey === `unit:${row.id}`
                      ? 'Saving...'
                      : canManage
                        ? 'Save'
                        : 'Manager required'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void deleteUnitAlias(row)}
                    disabled={savingKey === `unit:${row.id}` || !canManage}
                    title={canManage ? undefined : 'Manager access required'}
                  >
                    Delete
                  </Button>
                  <ActionFeedback
                    message={feedbackTarget === `unit:${row.id}` ? feedbackMessage : null}
                    tone={feedbackTone}
                  />
                </div>
              );
            })}
          </div>
        ) : null}
      </CollapsibleCard>
      ) : null}
    </div>
  );
}
