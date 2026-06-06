import { Fragment, useEffect, useMemo, useState } from 'react';
import type {
  Recipe,
  RecipeCreateInput,
  RecipeCostPayload,
  RecipeLineInput,
  RecipeUpdateInput,
  RecipeWithLines,
  RecipesPayload,
  RecipesSummary,
  StockItem,
  StockItemsPayload
} from '@alma/shared';
import { ActionFeedback, Badge, Button, Card, EmptyState, Input, Select, Spinner, StatCard, Textarea } from '@alma/ui';
import { IconChevronDown, IconRecipes } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';
import { confirmDangerousAction } from '../lib/confirmDangerousAction';
import { useAuth } from '../lib/auth';
import { canManageStock } from '../lib/stockPermissions';

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; recipe: RecipeWithLines };

type RecipeLineDraft = {
  ingredientName: string;
  quantity: string;
  unit: string;
  cost: string;
  wastePercent: string;
  itemId: string;
  subRecipeId: string;
};

type RecipeDraft = {
  title: string;
  kind: string;
  category: string;
  subcategory: string;
  venue: string;
  salePrice: string;
  portionSize: string;
  portionUnit: string;
  yieldQuantity: string;
  yieldUnit: string;
  isProduction: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
  estimatedCost: string;
  notes: string;
  lines: RecipeLineDraft[];
  venuePrices: Array<{ venue: string; salePrice: string }>;
};

type RecipeKindFilter = '' | 'FOOD' | 'BEVERAGE';
type RecipeKindBucket = 'FOOD' | 'BEVERAGE' | 'OTHER';
type RecipeViewMode = 'category' | 'table';
type RecipesPageMode = 'item' | 'production';

const PRODUCTION_RECIPE_CATEGORY = 'Production Recipes';
const PRODUCTION_RECIPE_MARKER = 'production recipe';

const RECIPE_KIND_FILTER_OPTIONS: Array<{ label: string; value: RecipeKindFilter }> = [
  { label: 'All recipes', value: '' },
  { label: 'Food', value: 'FOOD' },
  { label: 'Beverage', value: 'BEVERAGE' }
];

const RECIPE_KIND_OPTIONS: Array<{ label: string; value: RecipeKindFilter }> = [
  { label: 'Food', value: 'FOOD' },
  { label: 'Beverage', value: 'BEVERAGE' }
];

function recipeKindBucket(recipe: Pick<Recipe, 'kind' | 'category' | 'subcategory'>): RecipeKindBucket {
  const value = [recipe.kind ?? '', recipe.category ?? '', recipe.subcategory ?? '']
    .join(' ')
    .toLowerCase();

  if (
    /\b(bar|bev|beverage|cocktail|drink|wine|beer|spirit|liquor|coffee|tea|juice)\b/.test(
      value
    )
  ) {
    return 'BEVERAGE';
  }

  if (/\b(food|dish|prep|kitchen|menu|meal|sauce|dessert|starter|main)\b/.test(value)) {
    return 'FOOD';
  }

  if (recipe.kind === 'BEVERAGE' || recipe.kind === 'FOOD') {
    return recipe.kind;
  }

  return recipe.kind ? 'OTHER' : 'FOOD';
}

function recipeKindLabel(recipe: Pick<Recipe, 'kind' | 'category' | 'subcategory'>) {
  const bucket = recipeKindBucket(recipe);
  if (bucket === 'FOOD') return 'Food';
  if (bucket === 'BEVERAGE') return 'Beverage';
  return recipe.kind ?? 'Other';
}

function normaliseRecipeKindForForm(recipe: RecipeWithLines): RecipeKindFilter {
  return recipeKindBucket(recipe) === 'BEVERAGE' ? 'BEVERAGE' : 'FOOD';
}

function recipeCategoryGroupKey(kind: RecipeKindBucket, categoryName: string) {
  return `${kind}:${categoryName}`;
}

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatCurrencyCents(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return formatCurrency(value / 100);
}

function stockCostUnit(item: StockItem) {
  return item.countUnit ?? item.unit;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(1)}%`;
}

function formatQuantity(quantity: number | null, unit: string | null) {
  if (quantity === null) return '—';
  const value = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
  return unit ? `${value} ${unit}` : value;
}

function formatYield(recipe: Pick<Recipe, 'yieldQuantity' | 'yieldUnit'>) {
  return formatQuantity(recipe.yieldQuantity, recipe.yieldUnit);
}

function isProductionRecipe(recipe: Pick<Recipe, 'category' | 'subcategory' | 'title' | 'notes' | 'yieldQuantity' | 'isPrepRecipe'>) {
  if ('isPrepRecipe' in recipe && recipe.isPrepRecipe) return true;
  const value = [
    recipe.category ?? '',
    recipe.subcategory ?? '',
    recipe.title ?? '',
    recipe.notes ?? ''
  ]
    .join(' ')
    .toLowerCase();

  return (
    recipe.category === PRODUCTION_RECIPE_CATEGORY ||
    value.includes(PRODUCTION_RECIPE_MARKER) ||
    /\b(prep|batch|sauce|salsa|syrup|marinade|garnish|mise|component|production)\b/.test(value)
  );
}

function duplicateRecipeKey(recipe: Recipe) {
  return [
    recipe.title.trim().toLowerCase().replace(/\s+/g, ' '),
    recipe.kind?.trim().toLowerCase() ?? '',
    recipe.category?.trim().toLowerCase() ?? '',
    recipe.subcategory?.trim().toLowerCase() ?? '',
    recipe.venue?.trim().toLowerCase() ?? ''
  ].join('|');
}

export function RecipesPage({ mode = 'item' }: { mode?: RecipesPageMode }) {
  const isProductionMode = mode === 'production';
  useDocumentTitle(isProductionMode ? 'Production Recipes' : 'Item Recipes');
  const { user } = useAuth();
  const canManage = canManageStock(user);

  const [data, setData] = useState<RecipesPayload | null>(null);
  const [summary, setSummary] = useState<RecipesSummary | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('');
  const [kindFilter, setKindFilter] = useState<RecipeKindFilter>('');
  const [viewMode, setViewMode] = useState<RecipeViewMode>('category');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecipeWithLines | null>(null);
  const [costDetail, setCostDetail] = useState<RecipeCostPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [collapsedRecipeGroupIds, setCollapsedRecipeGroupIds] = useState<Set<string>>(
    () => new Set()
  );
  const [recipeGroupsInitialised, setRecipeGroupsInitialised] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [list, sum, itemPayload] = await Promise.all([
        api<RecipesPayload>('/api/recipes'),
        api<RecipesSummary>('/api/recipes/summary'),
        api<StockItemsPayload>('/api/items')
      ]);
      setData(list);
      setSummary(sum);
      setItems(itemPayload.items);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load recipes');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [] as Recipe[];
    const needle = search.trim().toLowerCase();
    return data.recipes.filter((recipe) => {
      if (recipe.status === 'ARCHIVED') return false;
      if (isProductionRecipe(recipe) !== isProductionMode) return false;
      if (category && recipe.category !== category) return false;
      if (kindFilter && recipeKindBucket(recipe) !== kindFilter) return false;
      if (!needle) return true;
      const haystack = [
        recipe.title,
        recipeKindLabel(recipe),
        recipe.kind ?? '',
        recipe.category ?? '',
        recipe.subcategory ?? '',
        recipe.venue ?? ''
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [data, search, category, kindFilter, isProductionMode]);

  const pageCategories = useMemo(() => {
    if (!data) return [] as string[];
    return Array.from(
      new Set(
        data.recipes
          .filter((recipe) => isProductionRecipe(recipe) === isProductionMode)
          .map((recipe) => recipe.category)
          .filter((value): value is string => Boolean(value))
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [data, isProductionMode]);

  const categoryOptions = useMemo(
    () => [
      { label: 'All categories', value: '' },
      ...pageCategories.map((c) => ({ label: c, value: c }))
    ],
    [pageCategories]
  );

  const recipeGroups = useMemo(() => {
    const groups = new Map<
      RecipeKindBucket,
      { key: RecipeKindBucket; label: string; categories: Map<string, Recipe[]> }
    >();

    for (const recipe of filtered) {
      const key = recipeKindBucket(recipe);
      const label = key === 'FOOD' ? 'Food' : key === 'BEVERAGE' ? 'Beverage' : 'Other';
      const group = groups.get(key) ?? { key, label, categories: new Map<string, Recipe[]>() };
      const categoryName = recipe.category ?? 'Uncategorised';
      group.categories.set(categoryName, [...(group.categories.get(categoryName) ?? []), recipe]);
      groups.set(key, group);
    }

    const order: RecipeKindBucket[] = ['FOOD', 'BEVERAGE', 'OTHER'];
    return Array.from(groups.values())
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
      .map((group) => ({
        ...group,
        categories: Array.from(group.categories.entries())
          .sort(([a], [b]) => {
            if (a === 'Uncategorised') return 1;
            if (b === 'Uncategorised') return -1;
            return a.localeCompare(b);
          })
          .map(([name, recipes]) => ({
            name,
            recipes: recipes
              .slice()
              .sort(
                (a, b) =>
                  (a.subcategory ?? '').localeCompare(b.subcategory ?? '') ||
                  a.title.localeCompare(b.title)
              )
          }))
      }));
  }, [filtered]);

  const duplicateGroups = useMemo(() => {
    const groups = new Map<string, Recipe[]>();
    for (const recipe of filtered) {
      const key = duplicateRecipeKey(recipe);
      groups.set(key, [...(groups.get(key) ?? []), recipe]);
    }
    return Array.from(groups.values()).filter((group) => group.length > 1);
  }, [filtered]);

  const duplicateExtraIds = useMemo(
    () => duplicateGroups.flatMap((group) => group.slice(1).map((recipe) => recipe.id)),
    [duplicateGroups]
  );

  const duplicateIds = useMemo(
    () => new Set(duplicateGroups.flatMap((group) => group.map((recipe) => recipe.id))),
    [duplicateGroups]
  );

  const selectedRecipes = useMemo(
    () => (data?.recipes ?? []).filter((recipe) => selectedIds.has(recipe.id)),
    [data, selectedIds]
  );

  const recipeCategoryGroupIds = useMemo(
    () =>
      recipeGroups.flatMap((group) =>
        group.categories.map((categoryGroup) =>
          recipeCategoryGroupKey(group.key, categoryGroup.name)
        )
      ),
    [recipeGroups]
  );

  const allRecipeGroupsCollapsed = Boolean(
    recipeCategoryGroupIds.length &&
      recipeCategoryGroupIds.every((id) => collapsedRecipeGroupIds.has(id))
  );

  useEffect(() => {
    if (recipeGroupsInitialised || recipeCategoryGroupIds.length === 0) return;
    setCollapsedRecipeGroupIds(new Set(recipeCategoryGroupIds));
    setRecipeGroupsInitialised(true);
  }, [recipeCategoryGroupIds, recipeGroupsInitialised]);

  // Deep link: /recipes?recipe=<id> opens that recipe straight into the editor
  // (used by the "Edit recipe" links in Reports). The param is then stripped so
  // a refresh doesn't reopen it.
  useEffect(() => {
    const deepId = new URLSearchParams(window.location.search).get('recipe');
    if (!deepId) return;
    let active = true;
    void (async () => {
      try {
        const full = await api<RecipeWithLines>(`/api/recipes/${deepId}`);
        if (active) setForm({ mode: 'edit', recipe: full });
      } catch {
        /* recipe may not exist / no access — ignore */
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete('recipe');
        window.history.replaceState({}, '', url.toString());
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleRow(recipe: Recipe) {
    if (expandedId === recipe.id) {
      setExpandedId(null);
      setDetail(null);
      setCostDetail(null);
      setDetailError(null);
      return;
    }
    setExpandedId(recipe.id);
    setDetail(null);
    setCostDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const [full, cost] = await Promise.all([
        api<RecipeWithLines>(`/api/recipes/${recipe.id}`),
        api<RecipeCostPayload>(`/api/recipes/${recipe.id}/cost`)
      ]);
      setDetail(full);
      setCostDetail(cost);
    } catch (err) {
      setDetailError(
        err instanceof ApiError ? err.message : 'Could not load recipe lines'
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function editRecipe(recipe: Recipe) {
    setDetailLoading(true);
    setDetailError(null);
    try {
      setForm({ mode: 'edit', recipe: await api<RecipeWithLines>(`/api/recipes/${recipe.id}`) });
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : 'Could not load recipe');
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleSaved() {
    setForm({ mode: 'closed' });
    setExpandedId(null);
    setDetail(null);
    setCostDetail(null);
    await load();
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleRecipeSelection(recipes: Recipe[]) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (recipes.every((recipe) => next.has(recipe.id))) {
        recipes.forEach((recipe) => next.delete(recipe.id));
      } else {
        recipes.forEach((recipe) => next.add(recipe.id));
      }
      return next;
    });
  }

  function toggleRecipeCategoryGroup(groupId: string) {
    setCollapsedRecipeGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  function toggleAllRecipeCategoryGroups() {
    setCollapsedRecipeGroupIds((current) => {
      const next = new Set(current);
      if (allRecipeGroupsCollapsed) {
        recipeCategoryGroupIds.forEach((id) => next.delete(id));
      } else {
        recipeCategoryGroupIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  async function deleteSelectedRecipes() {
    if (selectedIds.size === 0) return;
    if (!canManage) {
      setError('Manager access is required to delete recipes.');
      return;
    }
    const ids = Array.from(selectedIds);
    const sampleTitles = selectedRecipes
      .slice(0, 3)
      .map((recipe) => recipe.title)
      .join(', ');
    const confirmed = confirmDangerousAction({
      title: `Delete ${ids.length} recipe${ids.length === 1 ? '' : 's'}?`,
      message:
        `${sampleTitles ? `${sampleTitles}${ids.length > 3 ? ', ...' : ''}\n\n` : ''}` +
        'Ingredient lines for deleted recipes are also removed. This cannot be undone.',
      confirmationText: 'DELETE RECIPES'
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      await api<{ deleted: number }>('/api/recipes', {
        method: 'DELETE',
        body: JSON.stringify({ ids, confirmationText: 'DELETE RECIPES' })
      });
      setSelectedIds(new Set());
      setExpandedId((current) => (current && ids.includes(current) ? null : current));
      setDetail((current) => (current && ids.includes(current.id) ? null : current));
      setCostDetail((current) => (current && ids.includes(current.recipeId) ? null : current));
      if (form.mode === 'edit' && ids.includes(form.recipe.id)) {
        setForm({ mode: 'closed' });
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete recipes');
    } finally {
      setDeleting(false);
    }
  }

  const filteredLineCount = useMemo(
    () => filtered.reduce((total, recipe) => total + recipe.lineCount, 0),
    [filtered]
  );

  const filteredAverageCost = useMemo(() => {
    if (filtered.length === 0) return 0;
    return filtered.reduce((total, recipe) => total + recipe.estimatedCost, 0) / filtered.length;
  }, [filtered]);

  const pageLabel = isProductionMode ? 'Production Recipes' : 'Item Recipes';

  const cardTitle =
    form.mode === 'create'
      ? isProductionMode
        ? 'New production recipe'
        : 'New item recipe'
      : form.mode === 'edit'
        ? `Editing ${form.recipe.title}`
        : pageLabel;

  function renderRecipeRows(recipes: Recipe[]) {
    return recipes.map((recipe) => {
      const expanded = expandedId === recipe.id;
      return (
        <Fragment key={recipe.id}>
          <tr
            className={`row-interactive ${selectedIds.has(recipe.id) ? 'stock-selected-row' : ''}`}
            onClick={() => void toggleRow(recipe)}
          >
            <td className="select-cell">
              <input
                type="checkbox"
                aria-label={`Select ${recipe.title}`}
                checked={selectedIds.has(recipe.id)}
                onClick={(event) => event.stopPropagation()}
                onChange={() => toggleSelected(recipe.id)}
              />
            </td>
            <td>
              <span className="cell-stack">
                <strong>{recipe.title}</strong>
                <span className="subtle">
                  {recipe.subcategory ?? recipe.venue ?? ''}
                  {duplicateIds.has(recipe.id) ? (
                    <span className="stock-duplicate-hint">Possible duplicate</span>
                  ) : null}
                </span>
              </span>
            </td>
            <td>{recipeKindLabel(recipe)}</td>
            <td>
              {recipe.category ? <Badge tone="indigo">{recipe.category}</Badge> : '—'}
            </td>
            <td>{recipe.lineCount}</td>
            <td>{formatYield(recipe)}</td>
            <td>{recipe.salePriceCents === null ? '—' : formatCurrencyCents(recipe.salePriceCents)}</td>
            <td>{formatCurrency(recipe.estimatedCost)}</td>
            <td className="cell-actions">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="recipe-row-toggle"
                aria-expanded={expanded}
                onClick={(event) => {
                  event.stopPropagation();
                  void toggleRow(recipe);
                }}
                rightIcon={
                  <IconChevronDown
                    size={14}
                    className={
                      expanded ? 'recipe-row-toggle-icon is-open' : 'recipe-row-toggle-icon'
                    }
                  />
                }
              >
                {expanded ? 'Hide' : 'Show'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation();
                  void editRecipe(recipe);
                }}
              >
                Edit
              </Button>
            </td>
          </tr>
          {expanded ? (
            <tr className="row-detail">
              <td colSpan={9}>
                {detailLoading ? (
                  <Spinner label="Loading lines" />
                ) : detailError ? (
                  <p className="error-text">{detailError}</p>
                ) : detail && detail.id === recipe.id ? (
                  <RecipeLinesTable
                    detail={detail}
                    cost={costDetail?.recipeId === detail.id ? costDetail : null}
                    items={items}
                    allRecipes={data?.recipes ?? []}
                    onChanged={async (updated) => {
                      setDetail(updated);
                      try {
                        const refreshedCost = await api<RecipeCostPayload>(`/api/recipes/${updated.id}/cost`);
                        setCostDetail(refreshedCost);
                      } catch {
                        /* cost refresh failure is non-fatal */
                      }
                      void load();
                    }}
                  />
                ) : null}
              </td>
            </tr>
          ) : null}
        </Fragment>
      );
    });
  }

  function renderRecipesTable(recipes: Recipe[], emptyMessage: string) {
    const allRowsSelected = Boolean(
      recipes.length && recipes.every((recipe) => selectedIds.has(recipe.id))
    );

    return (
      <table>
        <thead>
          <tr>
            <th className="select-cell">
              <input
                type="checkbox"
                aria-label="Select visible recipes"
                checked={allRowsSelected}
                onChange={() => toggleRecipeSelection(recipes)}
              />
            </th>
            <th>Title</th>
            <th>Kind</th>
            <th>Category</th>
            <th>Lines</th>
            <th>Yield</th>
            <th>Sale price</th>
            <th>Est. cost</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {recipes.length > 0 ? (
            renderRecipeRows(recipes)
          ) : (
            <tr>
              <td colSpan={9} className="table-empty-cell">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }

  return (
    <div className="page-stack">
      <div className="stat-grid">
        <StatCard
          icon={<IconRecipes size={18} />}
          label={pageLabel}
          value={loading ? '—' : String(filtered.length)}
          hint={isProductionMode ? 'Reusable prep and batch components' : 'Menu items with ingredient lines'}
        />
        <StatCard
          label="Ingredient lines"
          value={loading ? '—' : String(filteredLineCount)}
          hint={isProductionMode ? 'Lines across production recipes' : 'Lines across item recipes'}
        />
        <StatCard
          label={isProductionMode ? 'Avg. batch cost' : 'Avg. item cost'}
          value={
            loading
              ? '—'
              : formatCurrency(filteredAverageCost)
          }
          hint={summary ? 'Estimated, manually reviewed' : 'Waiting for recipe summary'}
        />
      </div>

      <Card
        title={cardTitle}
        subtitle={
          form.mode === 'closed'
            ? isProductionMode
              ? 'Reusable prep, batch and mise en place recipes used as ingredients in menu items.'
              : 'Menu items, cocktails and wine pours with stock items or production recipes as ingredient lines.'
            : isProductionMode
              ? 'Build the batch recipe. Estimated costs are manual until production recipe roll-up is approved.'
              : 'Build item ingredient lines from stock items or production recipes. Cost warnings stay visible where cost data is missing.'
        }
        action={
          form.mode === 'closed' ? (
            <Button type="button" size="sm" onClick={() => setForm({ mode: 'create' })}>
              {isProductionMode ? 'New production recipe' : 'New item recipe'}
            </Button>
          ) : null
        }
      >
        {form.mode !== 'closed' ? (
          <RecipeForm
            mode={form.mode}
            initial={form.mode === 'edit' ? form.recipe : undefined}
            items={items}
            recipes={data?.recipes ?? []}
            categories={pageCategories}
            pageMode={mode}
            onSaved={() => void handleSaved()}
            onCancel={() => setForm({ mode: 'closed' })}
          />
        ) : loading ? (
          <Spinner label="Loading recipes" />
        ) : error ? (
          <EmptyState
            icon={<IconRecipes size={24} />}
            title="Recipes unavailable"
            description={error}
          />
        ) : data && data.recipes.length > 0 ? (
          <>
            <div className="stock-filter-toolbar stock-filter-toolbar-four">
              <Input
                label="Search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Search by title, kind or category"
              />
              <Select
                label="Food / beverage"
                value={kindFilter}
                onChange={(event) => setKindFilter(event.currentTarget.value as RecipeKindFilter)}
                options={RECIPE_KIND_FILTER_OPTIONS}
              />
              <Select
                label="Category"
                value={category}
                onChange={(event) => setCategory(event.currentTarget.value)}
                options={categoryOptions}
              />
              <Select
                label="View"
                value={viewMode}
                onChange={(event) => setViewMode(event.currentTarget.value as RecipeViewMode)}
                options={[
                  { label: 'By food / beverage', value: 'category' },
                  { label: 'Table', value: 'table' }
                ]}
              />
            </div>

            <div className="table-card">
              <div className="table-toolbar stock-bulk-toolbar">
                <span>
                  {selectedIds.size > 0
                    ? `${selectedIds.size} selected`
                    : `${filtered.length} ${isProductionMode ? 'production recipes' : 'item recipes'}`}
                </span>
                <span className="table-toolbar-right stock-bulk-actions">
                  {viewMode === 'category' &&
                  recipeCategoryGroupIds.length > 0 &&
                  selectedIds.size === 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleAllRecipeCategoryGroups}
                    >
                      {allRecipeGroupsCollapsed ? 'Expand all' : 'Collapse all'}
                    </Button>
                  ) : null}
                  {duplicateExtraIds.length > 0 && selectedIds.size === 0 ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedIds(new Set(duplicateExtraIds))}
                    >
                      Select duplicate extras
                    </Button>
                  ) : null}
                  {selectedIds.size > 0 ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedIds(new Set())}
                        disabled={deleting}
                      >
                        Clear
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => void deleteSelectedRecipes()}
                        disabled={deleting || !canManage}
                        title={canManage ? undefined : 'Manager access required'}
                      >
                        {deleting
                          ? 'Deleting...'
                          : canManage
                            ? 'Delete selected'
                            : 'Manager required'}
                      </Button>
                    </>
                  ) : duplicateGroups.length > 0 ? (
                    `${duplicateGroups.length} duplicate groups`
                  ) : (
                    'Expand a category, then show a recipe to see ingredient lines'
                  )}
                </span>
              </div>
              {viewMode === 'category' ? (
                <div className="stock-category-groups recipe-category-groups">
                  {recipeGroups.length > 0 ? (
                    recipeGroups.map((group) => (
                      <section key={group.key} className="recipe-kind-group">
                        <div className="stock-category-group-head recipe-kind-group-head">
                          <span>
                            <strong>{group.label}</strong>
                            <span className="subtle">
                              {group.categories.reduce(
                                (total, categoryGroup) => total + categoryGroup.recipes.length,
                                0
                              )}{' '}
                              recipe
                              {group.categories.reduce(
                                (total, categoryGroup) => total + categoryGroup.recipes.length,
                                0
                              ) === 1
                                ? ''
                                : 's'}
                            </span>
                          </span>
                        </div>
                        {group.categories.map((categoryGroup) => (
                          <RecipeCategorySection
                            key={`${group.key}-${categoryGroup.name}`}
                            groupId={recipeCategoryGroupKey(group.key, categoryGroup.name)}
                            name={categoryGroup.name}
                            recipes={categoryGroup.recipes}
                            collapsedRecipeGroupIds={collapsedRecipeGroupIds}
                            onToggle={toggleRecipeCategoryGroup}
                            renderRecipesTable={renderRecipesTable}
                          />
                        ))}
                      </section>
                    ))
                  ) : (
                    <div className="table-empty-cell">No recipes match the current filters.</div>
                  )}
                </div>
              ) : (
                renderRecipesTable(filtered, 'No recipes match the current filters.')
              )}
            </div>
          </>
        ) : (
          <EmptyState
            icon={<IconRecipes size={24} />}
            title={isProductionMode ? 'No production recipes yet' : 'No item recipes yet'}
            description={
              isProductionMode
                ? 'Create production recipes for sauces, salsas, syrups, garnishes and batched prep used across menu items.'
                : 'Create item recipes for dishes, cocktails, wine pours and other sellable menu items.'
            }
            action={<Button type="button" onClick={() => setForm({ mode: 'create' })}>{isProductionMode ? 'Create production recipe' : 'Create item recipe'}</Button>}
          />
        )}
      </Card>
    </div>
  );
}

function RecipeCategorySection({
  groupId,
  name,
  recipes,
  collapsedRecipeGroupIds,
  onToggle,
  renderRecipesTable
}: {
  groupId: string;
  name: string;
  recipes: Recipe[];
  collapsedRecipeGroupIds: Set<string>;
  onToggle: (groupId: string) => void;
  renderRecipesTable: (recipes: Recipe[], emptyMessage: string) => JSX.Element;
}) {
  const collapsed = collapsedRecipeGroupIds.has(groupId);

  return (
    <section className={collapsed ? 'stock-category-group is-collapsed' : 'stock-category-group'}>
      <button
        type="button"
        className="stock-category-group-head stock-category-group-toggle"
        aria-expanded={!collapsed}
        onClick={() => onToggle(groupId)}
      >
        <span>
          <strong>{name}</strong>
          <span className="subtle">
            {recipes.length} recipe{recipes.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className="stock-category-collapse-meta">
          <span>{collapsed ? 'Show' : 'Hide'}</span>
          <IconChevronDown
            size={15}
            className={
              collapsed ? 'stock-category-collapse-icon' : 'stock-category-collapse-icon is-open'
            }
          />
        </span>
      </button>
      {collapsed ? null : renderRecipesTable(recipes, 'No recipes in this category.')}
    </section>
  );
}

function emptyRecipeDraft(): RecipeDraft {
  return {
    title: '',
    kind: 'FOOD',
    category: '',
    subcategory: '',
    venue: '',
    salePrice: '',
    portionSize: '',
    portionUnit: '',
    yieldQuantity: '',
    yieldUnit: '',
    isProduction: false,
    status: 'ACTIVE',
    estimatedCost: '0',
    notes: '',
    lines: [{ ingredientName: '', quantity: '', unit: '', cost: '', wastePercent: '', itemId: '', subRecipeId: '' }],
    venuePrices: []
  };
}

function emptyProductionRecipeDraft(): RecipeDraft {
  return {
    ...emptyRecipeDraft(),
    category: PRODUCTION_RECIPE_CATEGORY,
    subcategory: 'Prep batch',
    yieldUnit: 'portion',
    isProduction: true,
    notes: 'Production recipe used as an ingredient in item recipes.'
  };
}

function draftFromRecipe(recipe: RecipeWithLines): RecipeDraft {
  return {
    title: recipe.title,
    kind: normaliseRecipeKindForForm(recipe),
    category: recipe.category ?? '',
    subcategory: recipe.subcategory ?? '',
    venue: recipe.venue ?? '',
    salePrice: recipe.salePriceCents === null ? '' : String(recipe.salePriceCents / 100),
    venuePrices: (recipe.venuePrices ?? []).map((p) => ({ venue: p.venue, salePrice: String(p.salePriceCents / 100) })),
    portionSize: recipe.portionSize === null ? '' : String(recipe.portionSize),
    portionUnit: recipe.portionUnit ?? '',
    yieldQuantity: recipe.yieldQuantity === null ? '' : String(recipe.yieldQuantity),
    yieldUnit: recipe.yieldUnit ?? '',
    isProduction: recipe.isPrepRecipe,
    status: recipe.status,
    estimatedCost: String(recipe.estimatedCost),
    notes: recipe.notes ?? '',
    lines: recipe.lines.map((line) => ({
      ingredientName: line.ingredientName,
      quantity: line.quantity === null ? '' : String(line.quantity),
      unit: line.unit ?? '',
      cost: line.cost === null ? '' : String(line.cost),
      wastePercent: line.wastePercent === null ? '' : String(line.wastePercent),
      itemId: line.itemId ?? '',
      subRecipeId: line.subRecipeId ?? ''
    }))
  };
}

function RecipeForm({
  mode,
  initial,
  items,
  recipes,
  categories,
  pageMode,
  onSaved,
  onCancel
}: {
  mode: 'create' | 'edit';
  initial?: RecipeWithLines;
  items: StockItem[];
  recipes: Recipe[];
  categories: string[];
  pageMode: RecipesPageMode;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RecipeDraft>(() =>
    initial ? draftFromRecipe(initial) : pageMode === 'production' ? emptyProductionRecipeDraft() : emptyRecipeDraft()
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error'>('success');
  const itemOptions = useMemo(
    () => [
      { label: 'Unlinked ingredient', value: '' },
      ...items.map((item) => ({ label: `${item.name} (${stockCostUnit(item)})`, value: item.id }))
    ],
    [items]
  );
  const productionRecipeOptions = useMemo(
    () => [
      { label: 'No production recipe', value: '' },
      ...recipes
        .filter((recipe) => recipe.id !== initial?.id && isProductionRecipe(recipe))
        .map((recipe) => ({
          label: `${recipe.title}${recipe.yieldQuantity === null ? '' : ` (${formatYield(recipe)})`}`,
          value: recipe.id
        }))
    ],
    [initial?.id, recipes]
  );
  const categoryOptions = useMemo(() => {
    const unique = Array.from(
      new Set([
        ...categories,
        ...(draft.category.trim() ? [draft.category.trim()] : [])
      ])
    ).sort((a, b) => a.localeCompare(b));

    return [
      { label: 'Uncategorised', value: '' },
      ...unique.map((name) => ({ label: name, value: name }))
    ];
  }, [categories, draft.category]);

  function update<K extends keyof RecipeDraft>(key: K, value: RecipeDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateLine(index: number, patch: Partial<RecipeLineDraft>) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line))
    }));
  }

  function selectItem(index: number, itemId: string) {
    const item = items.find((candidate) => candidate.id === itemId);
    const current = draft.lines[index];
    if (!current) return;
    updateLine(index, {
      itemId,
      subRecipeId: '',
      ingredientName: item?.name ?? current.ingredientName,
      unit: item?.unit ?? current.unit
    });
  }

  function selectProductionRecipe(index: number, subRecipeId: string) {
    const recipe = recipes.find((candidate) => candidate.id === subRecipeId);
    const current = draft.lines[index];
    if (!current) return;
    updateLine(index, {
      subRecipeId,
      itemId: '',
      ingredientName: recipe?.title ?? current.ingredientName,
      unit: recipe?.yieldUnit ?? current.unit
    });
  }

  function removeLine(index: number) {
    setDraft((current) => ({ ...current, lines: current.lines.filter((_, i) => i !== index) }));
  }

  async function submit() {
    setFeedback(null);
    if (!draft.title.trim()) {
      setFeedback('Recipe title is required');
      setFeedbackTone('error');
      return;
    }
    const lines: RecipeLineInput[] = draft.lines
      .filter((line) => line.ingredientName.trim())
      .map((line) => ({
        ingredientName: line.ingredientName.trim(),
        quantity: line.quantity === '' ? undefined : Number(line.quantity),
        unit: line.unit.trim(),
        cost: line.cost === '' ? undefined : Number(line.cost),
        wastePercent: line.wastePercent === '' ? undefined : Number(line.wastePercent),
        itemId: line.itemId,
        subRecipeId: line.subRecipeId
      }));
    const treatAsProduction = pageMode === 'production' || draft.isProduction;
    const payload: RecipeCreateInput = {
      title: draft.title.trim(),
      kind: draft.kind.trim(),
      // A recipe is a production (prep/batch) recipe when created in the
      // production view OR explicitly flagged via the toggle in the item editor.
      category: treatAsProduction ? (draft.category.trim() || PRODUCTION_RECIPE_CATEGORY) : draft.category.trim(),
      subcategory: treatAsProduction ? (draft.subcategory.trim() || 'Prep batch') : draft.subcategory.trim(),
      venue: draft.venue.trim(),
      salePriceCents: draft.salePrice === '' ? undefined : Math.round(Number(draft.salePrice) * 100),
        venuePrices: draft.venuePrices
          .filter((vp) => vp.venue.trim() !== '' && vp.salePrice !== '')
          .map((vp) => ({ venue: vp.venue.trim(), salePriceCents: Math.round(Number(vp.salePrice) * 100) })),
      portionSize: draft.portionSize === '' || !(Number(draft.portionSize) > 0) ? undefined : Number(draft.portionSize),
      portionUnit: draft.portionUnit.trim(),
      yieldQuantity: draft.yieldQuantity === '' ? undefined : Number(draft.yieldQuantity),
      yieldUnit: draft.yieldUnit.trim(),
      isPrepRecipe: treatAsProduction,
      status: draft.status,
      estimatedCost: Number(draft.estimatedCost || 0),
      notes: draft.notes.trim(),
      lines
    };

    setSaving(true);
    try {
      if (mode === 'edit' && initial) {
        const updatePayload: RecipeUpdateInput = payload;
        await api<RecipeWithLines>(`/api/recipes/${initial.id}`, {
          method: 'PATCH',
          body: JSON.stringify(updatePayload)
        });
      } else {
        await api<RecipeWithLines>('/api/recipes', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      setFeedback(mode === 'edit' ? 'Recipe saved.' : 'Recipe created.');
      setFeedbackTone('success');
      window.setTimeout(() => onSaved(), 500);
    } catch (err) {
      setFeedback(err instanceof ApiError ? err.message : 'Could not save recipe');
      setFeedbackTone('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="new-item-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="form-grid three">
        <Input label="Title" required value={draft.title} onChange={(event) => update('title', event.currentTarget.value)} />
        <Select
          label="Food / beverage"
          value={draft.kind}
          onChange={(event) => update('kind', event.currentTarget.value)}
          options={RECIPE_KIND_OPTIONS}
        />
        {pageMode === 'production' ? (
          <Input label="Manual batch cost fallback" type="number" step="0.01" value={draft.estimatedCost} onChange={(event) => update('estimatedCost', event.currentTarget.value)} />
        ) : (
          <Input label="Sale price" type="number" step="0.01" value={draft.salePrice} onChange={(event) => update('salePrice', event.currentTarget.value)} />
        )}
      </div>
      {pageMode === 'production' ? null : (
        <div className="recipe-venue-prices">
          <span className="recipe-venue-prices-label">Per-venue prices (optional)</span>
          {draft.venuePrices.map((vp, index) => (
            <div className="recipe-venue-price-row" key={index}>
              <input
                className="recipe-venue-price-venue"
                value={vp.venue}
                placeholder="Venue (matches Dish Margins filter)"
                onChange={(event) =>
                  update(
                    'venuePrices',
                    draft.venuePrices.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, venue: event.currentTarget.value } : row
                    )
                  )
                }
              />
              <input
                className="recipe-venue-price-amount"
                type="number"
                step="0.01"
                value={vp.salePrice}
                placeholder="Price ($)"
                onChange={(event) =>
                  update(
                    'venuePrices',
                    draft.venuePrices.map((row, rowIndex) =>
                      rowIndex === index ? { ...row, salePrice: event.currentTarget.value } : row
                    )
                  )
                }
              />
              <button
                type="button"
                className="recipe-venue-price-remove"
                aria-label="Remove venue price"
                onClick={() =>
                  update(
                    'venuePrices',
                    draft.venuePrices.filter((_, rowIndex) => rowIndex !== index)
                  )
                }
              >
                &times;
              </button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => update('venuePrices', [...draft.venuePrices, { venue: '', salePrice: '' }])}
          >
            + Add venue price
          </Button>
        </div>
      )}
      {pageMode === 'production' ? (
        <p className="recipe-costing-note">
          Production recipes are reusable prep or batch items. Add them to item recipes as production recipe ingredient lines once the batch is saved.
        </p>
      ) : null}
      <div className="form-grid three">
        <Select label="Category" value={draft.category} onChange={(event) => update('category', event.currentTarget.value)} options={categoryOptions} />
        <Input label="Subcategory" value={draft.subcategory} onChange={(event) => update('subcategory', event.currentTarget.value)} />
        <Input label="Venue" value={draft.venue} onChange={(event) => update('venue', event.currentTarget.value)} />
      </div>
      {pageMode !== 'production' ? (
        <label className="recipe-production-toggle">
          <input
            type="checkbox"
            checked={draft.isProduction}
            onChange={(event) => update('isProduction', event.currentTarget.checked)}
          />
          <span>
            <strong>Production recipe</strong>
            <small>Batch/prep used as an ingredient in other recipes (sauces, salsas, syrups). Enter the quantity it outputs below.</small>
          </span>
        </label>
      ) : null}
      <div className="form-grid three">
        <Input
          label={draft.isProduction || pageMode === 'production' ? 'Quantity output' : 'Yield quantity'}
          type="number"
          step="0.01"
          value={draft.yieldQuantity}
          onChange={(event) => update('yieldQuantity', event.currentTarget.value)}
        />
        <Input label="Yield unit" placeholder="kg, L, portions" value={draft.yieldUnit} onChange={(event) => update('yieldUnit', event.currentTarget.value)} />
        <Input label="Portion size" type="number" min="0" step="0.01" placeholder="Servings (leave blank for 1)" value={draft.portionSize} onChange={(event) => update('portionSize', event.currentTarget.value)} />
        <Input label="Portion unit" placeholder="portion, kg, L" value={draft.portionUnit} onChange={(event) => update('portionUnit', event.currentTarget.value)} />
        <Select
          label="Status"
          value={draft.status}
          onChange={(event) => update('status', event.currentTarget.value as RecipeDraft['status'])}
          options={[
            { label: 'Active', value: 'ACTIVE' },
            { label: 'Archived', value: 'ARCHIVED' }
          ]}
        />
      </div>
      <p className="recipe-costing-note">
        Costing uses linked stock item average costs first, then prep recipe yield costs, then manual line costs. Missing costs stay visible until the source item has a cost.
      </p>
      <Textarea label="Notes" rows={2} value={draft.notes} onChange={(event) => update('notes', event.currentTarget.value)} />

      <div className="stocktake-count-toolbar">
        <strong>{draft.lines.length} ingredient lines</strong>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => update('lines', [...draft.lines, { ingredientName: '', quantity: '', unit: '', cost: '', wastePercent: '', itemId: '', subRecipeId: '' }])}
        >
          Add line
        </Button>
      </div>

      <div className="recipe-edit-lines">
        {draft.lines.map((line, index) => (
          <div key={index} className="recipe-edit-line">
            <Select label="Linked item" value={line.itemId} onChange={(event) => selectItem(index, event.currentTarget.value)} options={itemOptions} />
            <Select label="Production recipe" value={line.subRecipeId} onChange={(event) => selectProductionRecipe(index, event.currentTarget.value)} options={productionRecipeOptions} />
            <Input label="Ingredient" required value={line.ingredientName} onChange={(event) => updateLine(index, { ingredientName: event.currentTarget.value })} />
            <Input label="Qty" type="number" step="0.01" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.currentTarget.value })} />
            <Input label="Unit" value={line.unit} onChange={(event) => updateLine(index, { unit: event.currentTarget.value })} />
            <Input label="Manual cost" type="number" step="0.01" value={line.cost} onChange={(event) => updateLine(index, { cost: event.currentTarget.value })} />
            <Input label="Waste %" type="number" step="0.01" value={line.wastePercent} onChange={(event) => updateLine(index, { wastePercent: event.currentTarget.value })} />
            <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(index)}>
              Remove
            </Button>
          </div>
        ))}
      </div>

      <div className="toolbar-right">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create recipe'}</Button>
        <ActionFeedback message={feedback} tone={feedbackTone} />
      </div>
    </form>
  );
}

function RecipeCostSummary({ cost }: { cost: RecipeCostPayload | null }) {
  if (!cost) return null;

  return (
    <div className="recipe-cost-summary">
      <div>
        <span>Batch cost</span>
        <strong>{formatCurrencyCents(cost.batchCostCents)}</strong>
      </div>
      <div>
        <span>Cost per portion</span>
        <strong>{formatCurrencyCents(cost.costPerPortionCents)}</strong>
      </div>
      <div>
        <span>Sale price</span>
        <strong>{formatCurrencyCents(cost.salePriceCents)}</strong>
      </div>
      <div>
        <span>Gross profit</span>
        <strong>{formatCurrencyCents(cost.grossProfitCents)}</strong>
      </div>
      <div>
        <span>Food cost</span>
        <strong>{formatPercent(cost.foodCostPercent)}</strong>
      </div>
      <div>
        <span>Missing costs</span>
        <strong>{cost.missingCostCount}</strong>
      </div>
    </div>
  );
}

type EditableLineDraft = {
  ingredientName: string;
  itemId: string;
  subRecipeId: string;
  quantity: string;
  unit: string;
  wastePercent: string;
};

function lineToDraft(line: RecipeWithLines['lines'][number]): EditableLineDraft {
  return {
    ingredientName: line.ingredientName,
    itemId: line.itemId ?? '',
    subRecipeId: line.subRecipeId ?? '',
    quantity: line.quantity != null ? String(line.quantity) : '',
    unit: line.unit ?? '',
    wastePercent: line.wastePercent != null ? String(line.wastePercent) : ''
  };
}

function RecipeLinesTable({
  detail,
  cost,
  items,
  allRecipes,
  onChanged
}: {
  detail: RecipeWithLines;
  cost: RecipeCostPayload | null;
  items: StockItem[];
  allRecipes: Recipe[];
  onChanged: (updated: RecipeWithLines) => void;
}) {
  const [drafts, setDrafts] = useState<EditableLineDraft[]>(() => detail.lines.map(lineToDraft));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Re-sync drafts when the underlying recipe changes (e.g. after save+reload
  // or when switching expanded rows)
  useEffect(() => {
    setDrafts(detail.lines.map(lineToDraft));
    setDirty(false);
    setMessage(null);
  }, [detail.id, detail.lines]);

  const costLines = new Map((cost?.lines ?? []).map((line) => [line.lineId, line]));

  const itemOptions = useMemo(
    () => [
      { label: 'Unlinked', value: '' },
      ...items
        .filter((item) => item.status !== 'ARCHIVED')
        .map((item) => ({ label: `${item.name} (${stockCostUnit(item)})`, value: item.id }))
    ],
    [items]
  );

  const subRecipeOptions = useMemo(
    () => [
      { label: 'None', value: '' },
      ...allRecipes
        .filter((recipe) => recipe.isPrepRecipe && recipe.id !== detail.id)
        .map((recipe) => ({ label: recipe.title, value: recipe.id }))
    ],
    [allRecipes, detail.id]
  );

  function updateDraft(index: number, patch: Partial<EditableLineDraft>) {
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft))
    );
    setDirty(true);
  }

  function pickItem(index: number, itemId: string) {
    const item = items.find((candidate) => candidate.id === itemId);
    updateDraft(index, {
      itemId,
      // Adopt the item's unit + name if the line was unset; don't clobber if
      // operator already typed something custom.
      unit: drafts[index]?.unit?.trim() ? drafts[index]!.unit : item?.unit ?? '',
      ingredientName: drafts[index]?.ingredientName?.trim() ? drafts[index]!.ingredientName : item?.name ?? ''
    });
  }

  function pickSubRecipe(index: number, subRecipeId: string) {
    const recipe = allRecipes.find((candidate) => candidate.id === subRecipeId);
    updateDraft(index, {
      subRecipeId,
      ingredientName: drafts[index]?.ingredientName?.trim() ? drafts[index]!.ingredientName : recipe?.title ?? ''
    });
  }

  function removeLine(index: number) {
    setDrafts((current) => current.filter((_, i) => i !== index));
    setDirty(true);
  }

  function addLine() {
    setDrafts((current) => [
      ...current,
      {
        ingredientName: '',
        itemId: '',
        subRecipeId: '',
        quantity: '',
        unit: '',
        wastePercent: ''
      }
    ]);
    setDirty(true);
  }

  async function saveChanges() {
    setSaving(true);
    setMessage(null);
    try {
      const linesPayload: RecipeLineInput[] = drafts
        .filter((line) => line.ingredientName.trim() || line.itemId || line.subRecipeId)
        .map((line) => {
          const out: RecipeLineInput = {
            ingredientName:
              line.ingredientName.trim() || (items.find((i) => i.id === line.itemId)?.name ?? 'Ingredient')
          };
          if (line.quantity.trim()) out.quantity = Number(line.quantity);
          if (line.unit.trim()) out.unit = line.unit.trim();
          if (line.itemId) out.itemId = line.itemId;
          if (line.subRecipeId) out.subRecipeId = line.subRecipeId;
          if (line.wastePercent.trim()) out.wastePercent = Number(line.wastePercent);
          return out;
        });
      const updated = await api<RecipeWithLines>(`/api/recipes/${detail.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: detail.title,
          category: detail.category ?? '',
          venue: detail.venue ?? '',
          salePriceCents: detail.salePriceCents ?? null,
          portionSize: detail.portionSize ?? null,
          portionUnit: detail.portionUnit ?? '',
          yieldQuantity: detail.yieldQuantity ?? null,
          yieldUnit: detail.yieldUnit ?? '',
          isPrepRecipe: detail.isPrepRecipe,
          status: detail.status,
          estimatedCost: detail.estimatedCost,
          notes: detail.notes ?? '',
          lines: linesPayload
        })
      });
      setMessage('Lines saved.');
      setDirty(false);
      onChanged(updated);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not save recipe lines');
    } finally {
      setSaving(false);
    }
  }

  if (detail.lines.length === 0 && drafts.length === 0) {
    return (
      <div className="recipe-lines">
        <p className="subtle">This recipe has no ingredient lines yet.</p>
        <Button type="button" size="sm" variant="secondary" onClick={addLine}>+ Add ingredient line</Button>
      </div>
    );
  }

  return (
    <div className="recipe-lines">
      <RecipeCostSummary cost={cost} />
      {cost?.warnings.length ? (
        <div className="recipe-cost-warnings">
          {cost.warnings.slice(0, 5).map((warning) => (
            <Badge key={warning} tone="warning">{warning}</Badge>
          ))}
          {cost.warnings.length > 5 ? <Badge tone="muted">+{cost.warnings.length - 5} more</Badge> : null}
        </div>
      ) : null}
      {drafts.some((draft) => draft.subRecipeId) ? (
        <p className="recipe-costing-note">
          Prep recipes are reusable ingredient lines. Their batch cost is divided by yield to calculate line cost where possible.
        </p>
      ) : null}
      <table className="recipe-lines-table recipe-lines-editable">
        <thead>
          <tr>
            <th>#</th>
            <th>Ingredient</th>
            <th>Linked item</th>
            <th>Production recipe</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Line cost</th>
            <th>Source</th>
            <th aria-label="Delete" />
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft, index) => {
            const persistedLine = detail.lines[index];
            const costLine = persistedLine ? costLines.get(persistedLine.id) : null;
            return (
              <tr key={persistedLine?.id ?? `draft-${index}`}>
                <td>{index + 1}</td>
                <td>
                  <input
                    type="text"
                    className="recipe-line-input"
                    value={draft.ingredientName}
                    onChange={(event) => updateDraft(index, { ingredientName: event.currentTarget.value })}
                    placeholder="Ingredient name"
                  />
                </td>
                <td>
                  <select
                    className="recipe-line-input"
                    value={draft.itemId}
                    onChange={(event) => pickItem(index, event.currentTarget.value)}
                  >
                    {itemOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="recipe-line-input"
                    value={draft.subRecipeId}
                    onChange={(event) => pickSubRecipe(index, event.currentTarget.value)}
                  >
                    {subRecipeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="recipe-line-input recipe-line-input-narrow"
                    value={draft.quantity}
                    onChange={(event) => updateDraft(index, { quantity: event.currentTarget.value })}
                    placeholder="0"
                  />
                </td>
                <td>
                  <input
                    type="text"
                    className="recipe-line-input recipe-line-input-narrow"
                    value={draft.unit}
                    onChange={(event) => updateDraft(index, { unit: event.currentTarget.value })}
                    placeholder="ml"
                  />
                </td>
                <td>{formatCurrencyCents(costLine?.lineCostCents ?? null)}</td>
                <td>
                  <Badge tone={costLine?.source === 'MISSING' || !costLine ? 'warning' : 'positive'}>
                    {costLine?.source ?? (persistedLine ? 'MISSING' : 'UNSAVED')}
                  </Badge>
                </td>
                <td>
                  <button
                    type="button"
                    className="recipe-line-delete"
                    onClick={() => removeLine(index)}
                    aria-label="Delete line"
                    title="Delete this ingredient"
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="recipe-lines-toolbar">
        <Button type="button" size="sm" variant="secondary" onClick={addLine} disabled={saving}>
          + Add ingredient line
        </Button>
        <span style={{ flex: 1 }} />
        {message ? (
          <span className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</span>
        ) : null}
        <Button
          type="button"
          size="sm"
          onClick={() => void saveChanges()}
          disabled={!dirty || saving}
        >
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </Button>
      </div>
    </div>
  );
}
