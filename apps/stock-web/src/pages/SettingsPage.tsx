import { useEffect, useMemo, useState } from 'react';
import type {
  RecipeCategory,
  RecipeCategoryKind,
  StockCategory,
  StockItemsPayload
} from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner } from '@alma/ui';
import { IconItems, IconRecipes, IconSettings } from '../lib/icons';
import { ApiError, api } from '../lib/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

type StockCategoryDraft = {
  name: string;
  description: string;
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

export function SettingsPage() {
  useDocumentTitle('Settings');

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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function loadSettings() {
    setLoading(true);
    try {
      const [itemsPayload, recipeCategoryPayload] = await Promise.all([
        api<StockItemsPayload>('/api/items'),
        api<RecipeCategory[]>('/api/recipes/categories')
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
    setSavingKey('stock:new');
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create stock category');
    } finally {
      setSavingKey(null);
    }
  }

  async function saveStockCategory(category: StockCategory) {
    const draft = stockDrafts[category.id] ?? stockDraftFromCategory(category);
    setSavingKey(`stock:${category.id}`);
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save stock category');
    } finally {
      setSavingKey(null);
    }
  }

  async function createRecipeCategory() {
    setSavingKey('recipe:new');
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create recipe category');
    } finally {
      setSavingKey(null);
    }
  }

  async function saveRecipeCategory(category: RecipeCategory) {
    const draft = recipeDrafts[category.id] ?? recipeDraftFromCategory(category);
    setSavingKey(`recipe:${category.id}`);
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save recipe category');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="page-stack">
      {error ? <p className="error-text">{error}</p> : null}

      <Card
        title="Stock categories"
        subtitle="Used by items, stocktake locations, and catalogue grouping."
        action={<Badge tone="info">{loading ? '—' : `${stockCategoryCount} categories`}</Badge>}
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
                onChange={(event) =>
                  setNewStockCategory((current) => ({
                    ...current,
                    name: event.currentTarget.value
                  }))
                }
                placeholder="e.g. Spirits"
              />
              <Input
                id="new-stock-category-description"
                label="Description"
                value={newStockCategory.description}
                onChange={(event) =>
                  setNewStockCategory((current) => ({
                    ...current,
                    description: event.currentTarget.value
                  }))
                }
                placeholder="Optional"
              />
              <span className="settings-category-count">New</span>
              <Button
                type="button"
                onClick={() => void createStockCategory()}
                disabled={savingKey === 'stock:new' || newStockCategory.name.trim().length < 2}
              >
                {savingKey === 'stock:new' ? 'Adding...' : 'Add'}
              </Button>
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
                    disabled={savingKey === `stock:${category.id}` || draft.name.trim().length < 2}
                  >
                    {savingKey === `stock:${category.id}` ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
      </Card>

      <Card
        title="Recipe categories"
        subtitle="Controls the recipe category dropdown and renames existing recipe category values."
        action={
          <Badge tone="indigo">{loading ? '—' : `${recipeCategoryCount} categories`}</Badge>
        }
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
                onChange={(event) =>
                  setNewRecipeCategory((current) => ({
                    ...current,
                    name: event.currentTarget.value
                  }))
                }
                placeholder="e.g. Cocktails"
              />
              <Select
                id="new-recipe-category-kind"
                label="Type"
                value={newRecipeCategory.kind}
                onChange={(event) =>
                  setNewRecipeCategory((current) => ({
                    ...current,
                    kind: event.currentTarget.value as RecipeCategoryKind
                  }))
                }
                options={RECIPE_CATEGORY_KIND_OPTIONS}
              />
              <Input
                id="new-recipe-category-description"
                label="Description"
                value={newRecipeCategory.description}
                onChange={(event) =>
                  setNewRecipeCategory((current) => ({
                    ...current,
                    description: event.currentTarget.value
                  }))
                }
                placeholder="Optional"
              />
              <span className="settings-category-count">New</span>
              <Button
                type="button"
                onClick={() => void createRecipeCategory()}
                disabled={
                  savingKey === 'recipe:new' || newRecipeCategory.name.trim().length < 2
                }
              >
                {savingKey === 'recipe:new' ? 'Adding...' : 'Add'}
              </Button>
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
                      savingKey === `recipe:${category.id}` || draft.name.trim().length < 2
                    }
                  >
                    {savingKey === `recipe:${category.id}` ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
      </Card>

      <Card title="Other settings" subtitle="Venue, units of measure and account preferences.">
        <EmptyState
          icon={<IconSettings size={24} />}
          title="More settings coming soon"
          description="Venue defaults, preferred units, and account preferences can be added here next."
        />
      </Card>
    </div>
  );
}
