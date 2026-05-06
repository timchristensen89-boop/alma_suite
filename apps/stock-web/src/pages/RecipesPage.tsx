import { Fragment, useEffect, useMemo, useState } from 'react';
import type {
  Recipe,
  RecipeCreateInput,
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

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; recipe: RecipeWithLines };

type RecipeLineDraft = {
  ingredientName: string;
  quantity: string;
  unit: string;
  cost: string;
  itemId: string;
};

type RecipeDraft = {
  title: string;
  kind: string;
  category: string;
  subcategory: string;
  venue: string;
  estimatedCost: string;
  notes: string;
  lines: RecipeLineDraft[];
};

type RecipeKindFilter = '' | 'FOOD' | 'BEVERAGE';
type RecipeKindBucket = 'FOOD' | 'BEVERAGE' | 'OTHER';
type RecipeViewMode = 'category' | 'table';

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

function formatQuantity(quantity: number | null, unit: string | null) {
  if (quantity === null) return '—';
  const value = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
  return unit ? `${value} ${unit}` : value;
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

export function RecipesPage() {
  useDocumentTitle('Recipes');

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
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [collapsedRecipeGroupIds, setCollapsedRecipeGroupIds] = useState<Set<string>>(
    () => new Set()
  );

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
  }, [data, search, category, kindFilter]);

  const categoryOptions = useMemo(
    () => [
      { label: 'All categories', value: '' },
      ...(data?.categories ?? []).map((c) => ({ label: c, value: c }))
    ],
    [data]
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

  async function toggleRow(recipe: Recipe) {
    if (expandedId === recipe.id) {
      setExpandedId(null);
      setDetail(null);
      setDetailError(null);
      return;
    }
    setExpandedId(recipe.id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const full = await api<RecipeWithLines>(`/api/recipes/${recipe.id}`);
      setDetail(full);
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
    const ids = Array.from(selectedIds);
    const sampleTitles = selectedRecipes
      .slice(0, 3)
      .map((recipe) => recipe.title)
      .join(', ');
    const confirmed = window.confirm(
      `Delete ${ids.length} recipe${ids.length === 1 ? '' : 's'}?` +
        (sampleTitles ? `\n\n${sampleTitles}${ids.length > 3 ? ', ...' : ''}` : '') +
        '\n\nIngredient lines for deleted recipes will also be removed. This cannot be undone.'
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await api<{ deleted: number }>('/api/recipes', {
        method: 'DELETE',
        body: JSON.stringify({ ids })
      });
      setSelectedIds(new Set());
      setExpandedId((current) => (current && ids.includes(current) ? null : current));
      setDetail((current) => (current && ids.includes(current.id) ? null : current));
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

  const cardTitle =
    form.mode === 'create'
      ? 'New recipe'
      : form.mode === 'edit'
        ? `Editing ${form.recipe.title}`
        : 'Recipes';

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
              <td colSpan={7}>
                {detailLoading ? (
                  <Spinner label="Loading lines" />
                ) : detailError ? (
                  <p className="error-text">{detailError}</p>
                ) : detail && detail.id === recipe.id ? (
                  <RecipeLinesTable detail={detail} />
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
            <th>Est. cost</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {recipes.length > 0 ? (
            renderRecipeRows(recipes)
          ) : (
            <tr>
              <td colSpan={7} className="table-empty-cell">
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
          label="Recipes"
          value={loading ? '—' : String(summary?.totalRecipes ?? 0)}
          hint="Across the kitchen and bar"
        />
        <StatCard
          label="Ingredient lines"
          value={loading ? '—' : String(summary?.totalLines ?? 0)}
          hint="Total across all recipes"
        />
        <StatCard
          label="Avg. cost"
          value={
            loading
              ? '—'
              : summary
                ? formatCurrency(summary.averageEstimatedCost)
                : '—'
          }
          hint="Mean estimated cost per recipe"
        />
      </div>

      <Card
        title={cardTitle}
        subtitle={
          form.mode === 'closed'
            ? 'Prepared items — cocktails, dishes, wine pours — and their ingredient lines.'
            : 'Build recipe lines and link ingredients to stock items for costing.'
        }
        action={
          form.mode === 'closed' ? (
            <Button type="button" size="sm" onClick={() => setForm({ mode: 'create' })}>
              New recipe
            </Button>
          ) : null
        }
      >
        {form.mode !== 'closed' ? (
          <RecipeForm
            mode={form.mode}
            initial={form.mode === 'edit' ? form.recipe : undefined}
            items={items}
            categories={data?.categories ?? []}
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
                    : `${filtered.length} of ${data.recipes.length} recipes`}
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
                        disabled={deleting}
                      >
                        {deleting ? 'Deleting...' : 'Delete selected'}
                      </Button>
                    </>
                  ) : duplicateGroups.length > 0 ? (
                    `${duplicateGroups.length} duplicate groups`
                  ) : (
                    'Click a row to see ingredient lines'
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
            title="No recipes yet"
            description="Create recipes here or run the legacy import to bring across cocktails, wine pours, and dishes from the old system."
            action={<Button type="button" onClick={() => setForm({ mode: 'create' })}>Create recipe</Button>}
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
    estimatedCost: '0',
    notes: '',
    lines: [{ ingredientName: '', quantity: '', unit: '', cost: '', itemId: '' }]
  };
}

function draftFromRecipe(recipe: RecipeWithLines): RecipeDraft {
  return {
    title: recipe.title,
    kind: normaliseRecipeKindForForm(recipe),
    category: recipe.category ?? '',
    subcategory: recipe.subcategory ?? '',
    venue: recipe.venue ?? '',
    estimatedCost: String(recipe.estimatedCost),
    notes: recipe.notes ?? '',
    lines: recipe.lines.map((line) => ({
      ingredientName: line.ingredientName,
      quantity: line.quantity === null ? '' : String(line.quantity),
      unit: line.unit ?? '',
      cost: line.cost === null ? '' : String(line.cost),
      itemId: line.itemId ?? ''
    }))
  };
}

function RecipeForm({
  mode,
  initial,
  items,
  categories,
  onSaved,
  onCancel
}: {
  mode: 'create' | 'edit';
  initial?: RecipeWithLines;
  items: StockItem[];
  categories: string[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<RecipeDraft>(() =>
    initial ? draftFromRecipe(initial) : emptyRecipeDraft()
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error'>('success');
  const itemOptions = useMemo(
    () => [
      { label: 'Unlinked ingredient', value: '' },
      ...items.map((item) => ({ label: `${item.name} (${item.unit})`, value: item.id }))
    ],
    [items]
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
      ingredientName: item?.name ?? current.ingredientName,
      unit: item?.unit ?? current.unit
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
        itemId: line.itemId
      }));
    const payload: RecipeCreateInput = {
      title: draft.title.trim(),
      kind: draft.kind.trim(),
      category: draft.category.trim(),
      subcategory: draft.subcategory.trim(),
      venue: draft.venue.trim(),
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
        <Input label="Estimated cost" type="number" step="0.01" value={draft.estimatedCost} onChange={(event) => update('estimatedCost', event.currentTarget.value)} />
      </div>
      <div className="form-grid three">
        <Select label="Category" value={draft.category} onChange={(event) => update('category', event.currentTarget.value)} options={categoryOptions} />
        <Input label="Subcategory" value={draft.subcategory} onChange={(event) => update('subcategory', event.currentTarget.value)} />
        <Input label="Venue" value={draft.venue} onChange={(event) => update('venue', event.currentTarget.value)} />
      </div>
      <Textarea label="Notes" rows={2} value={draft.notes} onChange={(event) => update('notes', event.currentTarget.value)} />

      <div className="stocktake-count-toolbar">
        <strong>{draft.lines.length} ingredient lines</strong>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => update('lines', [...draft.lines, { ingredientName: '', quantity: '', unit: '', cost: '', itemId: '' }])}
        >
          Add line
        </Button>
      </div>

      <div className="recipe-edit-lines">
        {draft.lines.map((line, index) => (
          <div key={index} className="recipe-edit-line">
            <Select label="Linked item" value={line.itemId} onChange={(event) => selectItem(index, event.currentTarget.value)} options={itemOptions} />
            <Input label="Ingredient" required value={line.ingredientName} onChange={(event) => updateLine(index, { ingredientName: event.currentTarget.value })} />
            <Input label="Qty" type="number" step="0.01" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.currentTarget.value })} />
            <Input label="Unit" value={line.unit} onChange={(event) => updateLine(index, { unit: event.currentTarget.value })} />
            <Input label="Cost" type="number" step="0.01" value={line.cost} onChange={(event) => updateLine(index, { cost: event.currentTarget.value })} />
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

function RecipeLinesTable({ detail }: { detail: RecipeWithLines }) {
  if (detail.lines.length === 0) {
    return <p className="subtle">This recipe has no ingredient lines yet.</p>;
  }

  return (
    <div className="recipe-lines">
      <table className="recipe-lines-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Ingredient</th>
            <th>Linked item</th>
            <th>Qty</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.position}</td>
              <td>{line.ingredientName}</td>
              <td>
                {line.item ? (
                  <span className="cell-stack">
                    <strong>{line.item.name}</strong>
                    <span className="subtle">{line.item.unit}</span>
                  </span>
                ) : (
                  <span className="subtle">Unlinked</span>
                )}
              </td>
              <td>{formatQuantity(line.quantity, line.unit)}</td>
              <td>{line.cost === null ? '—' : formatCurrency(line.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
