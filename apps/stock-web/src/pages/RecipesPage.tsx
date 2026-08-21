import { Fragment, useEffect, useMemo, useState } from 'react';
import type {
  Recipe,
  RecipeCreateInput,
  RecipeCostLine,
  RecipeCostPayload,
  RecipeLineInput,
  RecipeUpdateInput,
  RecipeWithLines,
  RecipesPayload,
  RecipesSummary,
  SetMenuComponentOption,
  SetMenuCourse,
  StockItem,
  StockItemsPayload
} from '@alma/shared';
// Values, not types — the import above is type-only.
import { DISH_DIETARY, parseDishDietary } from '@alma/shared';
import { ActionFeedback, Badge, Button, Card, EmptyState, Input, Select, Spinner, StatCard, Textarea } from '@alma/ui';
import { IconChevronDown, IconRecipes } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import { confirmDangerousAction } from '../lib/confirmDangerousAction';
import { useAuth } from '../lib/auth';
import { canManageStock } from '../lib/stockPermissions';
import { PortionsBuilder } from '../features/recipes/PortionsBuilder';

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; recipe: RecipeWithLines };

type RecipeLineDraft = {
  perGuests: string;
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
  printTitle: string;
  /** The line a guest reads on the QR menu. Never `notes`, which is internal. */
  guestDescription: string;
  /** DISH_DIETARY ids. Empty = nobody has checked, NOT "no allergens". */
  dietary: string[];
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

type RecipeKindFilter = '' | 'FOOD' | 'BEVERAGE' | 'SET_MENU';
type RecipeKindBucket = 'FOOD' | 'BEVERAGE' | 'SET_MENU' | 'OTHER';
type RecipeViewMode = 'category' | 'table';
type RecipesPageMode = 'item' | 'production';

const PRODUCTION_RECIPE_CATEGORY = 'Production Recipes';

const RECIPE_KIND_FILTER_OPTIONS: Array<{ label: string; value: RecipeKindFilter }> = [
  { label: 'All recipes', value: '' },
  { label: 'Food', value: 'FOOD' },
  { label: 'Beverage', value: 'BEVERAGE' },
  { label: 'Set menus & functions', value: 'SET_MENU' }
];

const RECIPE_KIND_OPTIONS: Array<{ label: string; value: RecipeKindFilter }> = [
  { label: 'Food', value: 'FOOD' },
  { label: 'Beverage', value: 'BEVERAGE' },
  { label: 'Set menu / function', value: 'SET_MENU' }
];

function recipeKindBucket(recipe: Pick<Recipe, 'kind' | 'category' | 'subcategory'>): RecipeKindBucket {
  if (recipe.kind === 'SET_MENU') return 'SET_MENU';
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
  if (bucket === 'SET_MENU') return 'Set menu';
  return recipe.kind ?? 'Other';
}

function normaliseRecipeKindForForm(recipe: RecipeWithLines): RecipeKindFilter {
  const bucket = recipeKindBucket(recipe);
  return bucket === 'BEVERAGE' || bucket === 'SET_MENU' ? bucket : 'FOOD';
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

function tidyQtyText(value: number) {
  return String(Math.round(value * 1000) / 1000);
}

// "Show the working" line for a costed ingredient: how the per-cost-unit price
// and the converted quantity multiply out to the line cost. Returns null when
// there isn't a meaningful trace (e.g. uncosted lines — the warning explains).
function costTraceText(line: RecipeCostLine | null): string | null {
  const trace = line?.trace;
  if (!trace || line.lineCostCents === null) return null;
  const parts: string[] = [];
  if (trace.conversionLabel) parts.push(trace.conversionLabel);
  if (trace.convertedQuantity !== null && line.unitCostCents !== null) {
    const unit = trace.costUnitLabel ? ` ${trace.costUnitLabel}` : '';
    let calc = `${tidyQtyText(trace.convertedQuantity)}${unit} × ${formatCurrencyCents(line.unitCostCents)}/${(trace.costUnitLabel ?? 'unit')}`;
    if (trace.wasteMultiplier > 1) calc += ` × ${trace.wasteMultiplier.toFixed(2)} waste`;
    calc += ` = ${formatCurrencyCents(line.lineCostCents)}`;
    parts.push(calc);
  } else if (line.source === 'MANUAL') {
    parts.push(`${formatCurrencyCents(line.lineCostCents)} entered manually`);
  }
  if (trace.costSource) parts.push(trace.costSource);
  return parts.length ? parts.join('  ·  ') : null;
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

function isProductionRecipe(recipe: Pick<Recipe, 'isPrepRecipe'>) {
  // Prep vs menu is driven solely by the explicit isPrepRecipe flag (backfilled
  // from the legacy heuristic). No more fragile keyword matching that pulled any
  // dish with "sauce"/"salsa" in its name into the Prep tab — and a manual
  // un-flag on a recipe now sticks instead of being overridden by the regex.
  return Boolean(recipe.isPrepRecipe);
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

// Standard, convertible recipe units. Solids: Unit / kg / g. Liquids: Unit / L
// / mL. "Unit" = one whole purchase unit, and the backend converts all of them
// to a consistent cost (1 Unit = 1 kg = 1000 g for a 1 kg item, etc.).
const SOLID_UNIT_OPTIONS = [
  { label: 'Unit', value: 'unit' },
  { label: 'kg', value: 'kg' },
  { label: 'g', value: 'g' }
];
const LIQUID_UNIT_OPTIONS = [
  { label: 'Unit', value: 'unit' },
  { label: 'L', value: 'l' },
  { label: 'mL', value: 'ml' }
];
const ALL_UNIT_OPTIONS = [...SOLID_UNIT_OPTIONS, { label: 'L', value: 'l' }, { label: 'mL', value: 'ml' }];

function isLiquidUnit(u: string | null | undefined): boolean {
  return ['ml', 'l', 'lt', 'ltr', 'litre', 'liter', 'litres', 'liters', 'millilitre', 'milliliter'].includes(
    (u ?? '').trim().toLowerCase()
  );
}

const MASS_UNITS = ['mg', 'g', 'kg', 'gram', 'grams', 'kilogram', 'kilograms', 'kilo'];
const VOLUME_UNITS = ['ml', 'cl', 'dl', 'l', 'litre', 'litres', 'liter', 'liters', 'millilitre', 'milliliter'];
const inFamily = (unit: string | null | undefined, family: string[]) =>
  family.includes((unit ?? '').trim().toLowerCase());

// Only the units that will ACTUALLY convert for this item, mirroring the backend
// engine: 'Unit' (= 1 cost unit) always works; the metric family works when the
// cost unit is metric OR a measure-per-unit bridge is set; a count-unit item
// with no measure bridge offers ONLY 'Unit', so you can't pick g/mL that fails.
function convertibleUnitOptionsForItem(item: StockItem): { label: string; value: string }[] {
  const costUnit = item.countUnit ?? item.unit;
  const measureUnit = item.measureUnit;
  const hasMeasureBridge = Boolean(item.measurePerCountUnit && item.measurePerCountUnit > 0 && measureUnit);
  if (inFamily(costUnit, MASS_UNITS) || (hasMeasureBridge && inFamily(measureUnit, MASS_UNITS))) {
    return SOLID_UNIT_OPTIONS; // Unit / kg / g
  }
  if (inFamily(costUnit, VOLUME_UNITS) || (hasMeasureBridge && inFamily(measureUnit, VOLUME_UNITS))) {
    return LIQUID_UNIT_OPTIONS; // Unit / L / mL
  }
  // Counted/each item with no weight/volume bridge — only whole units convert.
  return [{ label: 'Unit', value: 'unit' }];
}

// Units offered for a recipe line, constrained to the linked item's (or prep
// recipe's) solid-vs-liquid nature so staff pick from a consistent vocabulary
// instead of typing free-form units that don't convert.
function lineUnitOptions(
  unit: string | undefined,
  itemId: string | undefined,
  subRecipeId: string | undefined,
  items: StockItem[],
  recipes: Recipe[]
): { label: string; value: string }[] {
  let base = ALL_UNIT_OPTIONS;
  if (itemId) {
    const item = items.find((i) => i.id === itemId);
    if (item) {
      base = convertibleUnitOptionsForItem(item);
    }
  } else if (subRecipeId) {
    const rec = recipes.find((r) => r.id === subRecipeId);
    if (rec && !rec.isPrepRecipe) {
      // Linked menu dish: quantity means SERVES (0.5 = half a serve).
      base = [{ label: 'serve', value: 'serve' }];
    } else if (rec) {
      base = isLiquidUnit(rec.yieldUnit) ? LIQUID_UNIT_OPTIONS : SOLID_UNIT_OPTIONS;
    }
  }
  // Keep an existing non-standard unit as an option so editing an old recipe
  // doesn't silently change it; the user can switch to a standard one.
  const cur = (unit ?? '').trim();
  if (cur && !base.some((o) => o.value === cur.toLowerCase())) {
    return [{ label: cur, value: cur }, ...base];
  }
  return base;
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
  const [exportingRecipes, setExportingRecipes] = useState(false);

  async function downloadRecipesCsv() {
    setExportingRecipes(true);
    setError(null);
    try {
      await downloadCsv('/api/recipes/export.csv', 'alma-recipes.csv');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export recipes CSV');
    } finally {
      setExportingRecipes(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const [list, sum, itemPayload] = await Promise.all([
        api<RecipesPayload>('/api/recipes'),
        api<RecipesSummary>('/api/recipes/summary'),
        api<StockItemsPayload>('/api/items/picker')
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
      const label =
        key === 'FOOD' ? 'Food' : key === 'BEVERAGE' ? 'Beverage' : key === 'SET_MENU' ? 'Set menus & functions' : 'Other';
      const group = groups.get(key) ?? { key, label, categories: new Map<string, Recipe[]>() };
      const categoryName = recipe.category ?? 'Uncategorised';
      group.categories.set(categoryName, [...(group.categories.get(categoryName) ?? []), recipe]);
      groups.set(key, group);
    }

    const order: RecipeKindBucket[] = ['SET_MENU', 'FOOD', 'BEVERAGE', 'OTHER'];
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
    const params = new URLSearchParams(window.location.search);
    // ?q= pre-fills the search box — used by Reports' set-menu "Cost →" links
    // so a course lands here already filtered.
    const query = params.get('q');
    if (query) {
      setSearch(query);
      const url = new URL(window.location.href);
      url.searchParams.delete('q');
      window.history.replaceState({}, '', url.toString());
    }
    const deepId = params.get('recipe');
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
                {detail && detail.id === recipe.id && detail.isPrepRecipe ? (
                  <div className="card stock-portions-card">
                    <PortionsBuilder parentType="recipe" parentId={detail.id} canManage={canManage} />
                  </div>
                ) : null}
                {detail && detail.id === recipe.id && detail.kind === 'SET_MENU' ? (
                  <SetMenuCoursesPanel
                    menuId={detail.id}
                    canManage={canManage}
                    allRecipes={data?.recipes ?? []}
                  />
                ) : null}
                {detail && detail.id === recipe.id && detail.kind === 'SET_MENU' ? (
                  <SetMenuComponentsPanel
                    menuId={detail.id}
                    canManage={canManage}
                    onAdded={async () => {
                      try {
                        const [full, refreshedCost] = await Promise.all([
                          api<RecipeWithLines>(`/api/recipes/${recipe.id}`),
                          api<RecipeCostPayload>(`/api/recipes/${recipe.id}/cost`)
                        ]);
                        setDetail(full);
                        setCostDetail(refreshedCost);
                      } catch {
                        /* refresh failure is non-fatal */
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
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={exportingRecipes}
                title="Download every recipe as a CSV (type, category, portion/yield, cost, ingredients)"
                onClick={() => void downloadRecipesCsv()}
              >
                {exportingRecipes ? 'Exporting…' : 'Export CSV'}
              </Button>
              <Button type="button" size="sm" onClick={() => setForm({ mode: 'create' })}>
                {isProductionMode ? 'New production recipe' : 'New item recipe'}
              </Button>
            </div>
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
    printTitle: '',
    guestDescription: '',
    dietary: [],
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
    lines: [{ ingredientName: '', quantity: '', unit: '', cost: '', wastePercent: '', perGuests: '', itemId: '', subRecipeId: '' }],
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
    printTitle: recipe.printTitle ?? '',
    guestDescription: recipe.guestDescription ?? '',
    dietary: parseDishDietary(recipe.dietary),
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
      perGuests: line.perGuests === null ? '' : String(line.perGuests),
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
        perGuests: line.perGuests === '' ? undefined : Number(line.perGuests),
        itemId: line.itemId,
        subRecipeId: line.subRecipeId
      }));
    const treatAsProduction = pageMode === 'production' || draft.isProduction;
    const payload: RecipeCreateInput = {
      title: draft.title.trim(),
      printTitle: draft.printTitle.trim(),
      guestDescription: draft.guestDescription.trim(),
      dietary: draft.dietary,
      kind: draft.kind.trim(),
      // A recipe is a production (prep/batch) recipe when created in the
      // production view OR explicitly flagged via the toggle in the item editor.
      category: treatAsProduction
        ? (draft.category.trim() || PRODUCTION_RECIPE_CATEGORY)
        : draft.kind === 'SET_MENU'
          ? (draft.category.trim() || 'Set Menus')
          : draft.category.trim(),
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
        <Input
          label="Print name"
          value={draft.printTitle}
          onChange={(event) => update('printTitle', event.currentTarget.value)}
          placeholder="Kitchen docket name — blank uses the title"
        />
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
      {/* Guest description. Its own row because it is prose, and next to
          Dietary because these two are the only fields on this form a GUEST
          ever reads. `Notes`, further down, is the opposite: internal, and it
          is never sent to the QR menu. */}
      <div className="form-grid">
        <Input
          label="Guest description"
          value={draft.guestDescription}
          maxLength={240}
          onChange={(event) => update('guestDescription', event.currentTarget.value)}
          placeholder="Pipian mole, pepitas"
          hint="Shown under the dish on the QR menu — the menu's own line, word for word. Leave blank and the guest sees the dish name alone. Not the same as Notes, which stays internal."
        />
      </div>
      {/* Dietary — a claim about a plate, so it is deliberately plain
          checkboxes rather than something clever. Nothing here is inferred:
          a dish is only gluten free because somebody ticked it.

          Empty is NOT a claim. An unticked dish reads as "nobody has checked"
          everywhere it is used, never as "free of everything" — the register's
          filter excludes unmarked dishes rather than offering them. */}
      <fieldset className="form-fieldset">
        <legend>Dietary</legend>
        <p className="form-hint">
          Only tick what the kitchen has actually confirmed. Anything left unticked shows on the register as
          &ldquo;not checked&rdquo;, which is the honest answer — it is never read as safe.
        </p>
        <div className="dietary-picker">
          {DISH_DIETARY.map((tag) => {
            const on = draft.dietary.includes(tag.id);
            return (
              <label key={tag.id} className={`dietary-tag is-${tag.kind} ${on ? 'is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(event) =>
                    update(
                      'dietary',
                      event.currentTarget.checked
                        ? parseDishDietary([...draft.dietary, tag.id])
                        : draft.dietary.filter((id) => id !== tag.id)
                    )
                  }
                />
                <span>{tag.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
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
        <Select label="Yield unit" value={draft.yieldUnit} onChange={(event) => update('yieldUnit', event.currentTarget.value)} options={lineUnitOptions(draft.yieldUnit, undefined, undefined, items, recipes)} />
        <Input label="Portion size" type="number" min="0" step="0.01" placeholder="Servings (leave blank for 1)" value={draft.portionSize} onChange={(event) => update('portionSize', event.currentTarget.value)} />
        <Select label="Portion unit" value={draft.portionUnit} onChange={(event) => update('portionUnit', event.currentTarget.value)} options={lineUnitOptions(draft.portionUnit, undefined, undefined, items, recipes)} />
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
          onClick={() => update('lines', [...draft.lines, { ingredientName: '', quantity: '', unit: '', cost: '', wastePercent: '', perGuests: '', itemId: '', subRecipeId: '' }])}
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
            <Input label="Amount" type="number" step="0.01" className="recipe-amount-input" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.currentTarget.value })} />
            <Select label="Unit" value={line.unit} onChange={(event) => updateLine(index, { unit: event.currentTarget.value })} options={lineUnitOptions(line.unit, line.itemId, line.subRecipeId, items, recipes)} />
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
  perGuests: string;
};

function lineToDraft(line: RecipeWithLines['lines'][number]): EditableLineDraft {
  return {
    ingredientName: line.ingredientName,
    itemId: line.itemId ?? '',
    subRecipeId: line.subRecipeId ?? '',
    quantity: line.quantity != null ? String(line.quantity) : '',
    unit: line.unit ?? '',
    wastePercent: line.wastePercent != null ? String(line.wastePercent) : '',
    perGuests: line.perGuests != null ? String(line.perGuests) : ''
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
  // Live cost preview computed from the unsaved drafts so cost + per-line
  // warnings update as you type, without saving. Null = show the saved cost.
  const [livePreview, setLivePreview] = useState<RecipeCostPayload | null>(null);

  // Re-sync drafts when the underlying recipe changes (e.g. after save+reload
  // or when switching expanded rows)
  useEffect(() => {
    setDrafts(detail.lines.map(lineToDraft));
    setDirty(false);
    setMessage(null);
    setLivePreview(null);
  }, [detail.id, detail.lines]);

  // Debounced live cost-as-you-type: recost the unsaved draft on every edit.
  useEffect(() => {
    if (!dirty) {
      setLivePreview(null);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const preview = await api<RecipeCostPayload>('/api/recipes/cost-preview', {
          method: 'POST',
          body: JSON.stringify({
            kind: detail.kind,
            yieldQuantity: detail.yieldQuantity,
            yieldUnit: detail.yieldUnit,
            portionSize: detail.portionSize,
            portionUnit: detail.portionUnit,
            salePriceCents: detail.salePriceCents,
            isPrepRecipe: detail.isPrepRecipe,
            estimatedCost: detail.estimatedCost,
            lines: drafts.map((draft) => ({
              ingredientName: draft.ingredientName,
              quantity: draft.quantity === '' ? null : Number(draft.quantity),
              unit: draft.unit,
              wastePercent: draft.wastePercent === '' ? null : Number(draft.wastePercent),
              perGuests: draft.perGuests === '' ? null : Number(draft.perGuests),
              itemId: draft.itemId || null,
              subRecipeId: draft.subRecipeId || null
            }))
          })
        });
        setLivePreview(preview);
      } catch {
        /* keep the last preview on a transient error */
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [drafts, dirty, detail.id, detail.kind, detail.yieldQuantity, detail.yieldUnit, detail.portionSize, detail.portionUnit, detail.salePriceCents, detail.isPrepRecipe, detail.estimatedCost]);

  const effectiveCost = livePreview ?? cost;
  const usingLivePreview = livePreview !== null;
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

  const isSetMenu = detail.kind === 'SET_MENU';
  // Set menus compose whole menu dishes (and preps); normal recipes compose
  // production recipes only.
  // Any recipe can link a MENU DISH as a line ("Kingfish Ceviche (1pc)*" =
  // 0.5 serves of the main): the component's cost derives from the dish and
  // follows it automatically. Preps list first, dishes after.
  const subRecipeOptions = useMemo(
    () => [
      { label: 'None', value: '' },
      ...allRecipes
        .filter((recipe) => recipe.id !== detail.id && recipe.isPrepRecipe && !isSetMenu)
        .map((recipe) => ({ label: `Prep · ${recipe.title}`, value: recipe.id })),
      ...allRecipes
        .filter(
          (recipe) =>
            recipe.id !== detail.id && !recipe.isPrepRecipe && recipe.kind !== 'SET_MENU' && recipe.status === 'ACTIVE'
        )
        .map((recipe) => ({
          label: `Dish · ${recipe.title}${recipe.venue ? ` (${recipe.venue})` : ''}`,
          value: recipe.id
        }))
    ],
    [allRecipes, detail.id, isSetMenu]
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
        wastePercent: '',
        perGuests: ''
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
          if (line.perGuests.trim()) out.perGuests = Number(line.perGuests);
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
      <RecipeCostSummary cost={effectiveCost} />
      {usingLivePreview ? <p className="recipe-costing-note">Live preview — costs update as you edit. Save to store.</p> : null}
      {effectiveCost?.warnings.length ? (
        <div className="recipe-cost-warnings">
          {effectiveCost.warnings.slice(0, 5).map((warning) => (
            <Badge key={warning} tone="warning">{warning}</Badge>
          ))}
          {effectiveCost.warnings.length > 5 ? <Badge tone="muted">+{effectiveCost.warnings.length - 5} more</Badge> : null}
        </div>
      ) : null}
      {isSetMenu ? (
        <p className="recipe-costing-note">
          Every line is per guest: a dish's cost × qty, ÷ "shared between" for items that land once per 2 or 4 guests. The
          total below is the menu's food cost per person against its per-person price.
        </p>
      ) : drafts.some((draft) => draft.subRecipeId) ? (
        <p className="recipe-costing-note">
          Prep recipes are reusable ingredient lines. Their batch cost is divided by yield to calculate line cost where possible.
        </p>
      ) : null}
      <table className="recipe-lines-table recipe-lines-editable">
        <thead>
          <tr>
            <th>#</th>
            <th>{isSetMenu ? 'Component' : 'Ingredient'}</th>
            <th>Linked item</th>
            <th>{isSetMenu ? 'Dish / prep recipe' : 'Production recipe'}</th>
            <th>{isSetMenu ? 'Qty pp' : 'Qty'}</th>
            <th>Unit</th>
            {isSetMenu ? <th>Shared between</th> : null}
            <th>Line cost</th>
            <th>Source</th>
            <th aria-label="Delete" />
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft, index) => {
            const persistedLine = detail.lines[index];
            // Live-preview lines come back in draft order (no persisted id), so
            // match by index; saved lines match by their persisted id.
            const costLine = usingLivePreview
              ? effectiveCost?.lines[index] ?? null
              : persistedLine
                ? costLines.get(persistedLine.id) ?? null
                : null;
            const lineWarnings = costLine?.warnings ?? [];
            return (
              <Fragment key={persistedLine?.id ?? `draft-${index}`}>
              <tr className={lineWarnings.length ? 'recipe-line-has-warning' : ''}>
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
                    className="recipe-line-input recipe-amount-input"
                    value={draft.quantity}
                    onChange={(event) => updateDraft(index, { quantity: event.currentTarget.value })}
                    placeholder="0"
                  />
                </td>
                <td>
                  <select
                    className="recipe-line-input recipe-line-input-narrow"
                    value={draft.unit}
                    onChange={(event) => updateDraft(index, { unit: event.currentTarget.value })}
                  >
                    {lineUnitOptions(draft.unit, draft.itemId, draft.subRecipeId, items, allRecipes).map(
                      (opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      )
                    )}
                  </select>
                </td>
                {isSetMenu ? (
                  <td>
                    <select
                      className="recipe-line-input recipe-line-input-narrow"
                      value={draft.perGuests}
                      onChange={(event) => updateDraft(index, { perGuests: event.currentTarget.value })}
                    >
                      <option value="">Each guest</option>
                      <option value="2">2 guests</option>
                      <option value="4">4 guests</option>
                      <option value="6">6 guests</option>
                      <option value="8">8 guests</option>
                    </select>
                  </td>
                ) : null}
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
              {lineWarnings.length ? (
                <tr className="recipe-line-warning-detail">
                  <td />
                  <td colSpan={isSetMenu ? 9 : 8}>{lineWarnings.join(' ')}</td>
                </tr>
              ) : null}
              {!lineWarnings.length && costTraceText(costLine) ? (
                <tr className="recipe-line-trace-detail">
                  <td />
                  <td colSpan={isSetMenu ? 9 : 8}>{costTraceText(costLine)}</td>
                </tr>
              ) : null}
              </Fragment>
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


// ── Square set-menu components ("*" items) ──────────────────────────────────
// Zero-priced Square modifiers whose name ends in "*" (or starts "BB ") are
// the POS-side components of set menus. This panel lists them with their
// mapped recipe's cost so they can be dropped onto this menu — or every menu —
// as costed lines, shared between 1/2/4 guests.
// The choosing part of a set menu: which courses a guest picks from, and what
// is on offer tonight. Two jobs, deliberately separated — flipping a dish on
// or off happens most services and saves itself on the tap; changing the shape
// of the menu is rarer and saves as a whole.
// The course cycle the register fires on. posService.listCourses seeds exactly
// these names and pos-web falls back to them, so a course picked here already
// has a column on the fire screen. It was a free-text box until a banquet came
// out as a dozen one-dish courses, each named after its own dish.
const POS_COURSE_NAMES = ['NOW', 'Course 1', 'Course 2', 'Course 3', 'Course 4', 'Course 5', 'Course 6'];

type CourseDraft = {
  id: string | null;
  name: string;
  posCourse: string;
  pick: string;
  /** Blank = one serve each. "4" = one serve between four. */
  perGuests: string;
  options: Array<{ id: string | null; recipeId: string; title: string; supplement: string; available: boolean }>;
};

function toDrafts(courses: SetMenuCourse[]): CourseDraft[] {
  return courses.map((course) => ({
    id: course.id,
    name: course.name,
    posCourse: course.posCourse ?? '',
    pick: String(course.pick),
    perGuests: course.perGuests ? String(course.perGuests) : '',
    options: course.options.map((option) => ({
      id: option.id,
      recipeId: option.recipeId,
      title: option.title,
      supplement: option.supplementCents ? (option.supplementCents / 100).toFixed(2) : '',
      available: option.available
    }))
  }));
}

function SetMenuCoursesPanel({
  menuId,
  canManage,
  allRecipes
}: {
  menuId: string;
  canManage: boolean;
  allRecipes: Recipe[];
}) {
  const [courses, setCourses] = useState<SetMenuCourse[] | null>(null);
  const [drafts, setDrafts] = useState<CourseDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const rows = await api<SetMenuCourse[]>(`/api/recipes/${menuId}/courses`);
        if (!live) return;
        setCourses(rows);
        setDrafts(toDrafts(rows));
        setDirty(false);
        setError(null);
      } catch (err) {
        if (live) setError(err instanceof ApiError ? err.message : 'Could not load the courses');
      }
    })();
    return () => {
      live = false;
    };
  }, [menuId]);

  const dishOptions = useMemo(
    () => [
      { label: 'Choose a dish…', value: '' },
      ...allRecipes
        .filter((recipe) => recipe.id !== menuId && !recipe.isPrepRecipe && recipe.kind !== 'SET_MENU' && recipe.status === 'ACTIVE')
        .map((recipe) => ({
          label: `${recipe.title}${recipe.venue ? ` (${recipe.venue})` : ''}`,
          value: recipe.id
        }))
    ],
    [allRecipes, menuId]
  );

  function patchCourse(index: number, patch: Partial<CourseDraft>) {
    setDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
    setDirty(true);
  }

  function addOption(index: number, recipeId: string) {
    if (!recipeId) return;
    const dish = allRecipes.find((recipe) => recipe.id === recipeId);
    setDrafts((current) =>
      current.map((draft, i) =>
        i !== index || draft.options.some((option) => option.recipeId === recipeId)
          ? draft
          : {
              ...draft,
              options: [
                ...draft.options,
                { id: null, recipeId, title: dish?.title ?? 'Dish', supplement: '', available: true }
              ]
            }
      )
    );
    setDirty(true);
  }

  // Tonight's menu. A saved option saves itself the moment it is tapped —
  // this is the thing that changes most services, and nobody should have to
  // find a Save button to take a sold-out dish off the register.
  async function toggleTonight(optionId: string, available: boolean) {
    setNote(null);
    // Paint first: the register picks this up on its next menu poll either way.
    setCourses((current) =>
      current
        ? current.map((course) => ({
            ...course,
            options: course.options.map((option) => (option.id === optionId ? { ...option, available } : option))
          }))
        : current
    );
    try {
      await api(`/api/recipes/set-menu-options/${optionId}/availability`, {
        method: 'PATCH',
        body: JSON.stringify({ available })
      });
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Could not update tonight\u2019s menu');
      const rows = await api<SetMenuCourse[]>(`/api/recipes/${menuId}/courses`).catch(() => null);
      if (rows) setCourses(rows);
    }
  }

  async function save() {
    setSaving(true);
    setNote(null);
    try {
      const rows = await api<SetMenuCourse[]>(`/api/recipes/${menuId}/courses`, {
        method: 'PUT',
        body: JSON.stringify({
          courses: drafts
            .filter((draft) => draft.name.trim())
            .map((draft) => ({
              name: draft.name.trim(),
              posCourse: draft.posCourse.trim() || null,
              pick: Number(draft.pick) || 1,
              // Blank means one each, which is not the same as "shared
              // between 1" — send null so the register keeps its default.
              perGuests: Number(draft.perGuests) > 1 ? Number(draft.perGuests) : null,
              options: draft.options.map((option) => ({
                recipeId: option.recipeId,
                supplementCents: option.supplement.trim() ? Math.round(Number(option.supplement) * 100) : 0,
                available: option.available
              }))
            }))
        })
      });
      setCourses(rows);
      setDrafts(toDrafts(rows));
      setDirty(false);
      setNote('Saved — the register picks this up on its next menu refresh.');
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Could not save the courses');
    } finally {
      setSaving(false);
    }
  }

  const tonightRows = (courses ?? []).filter((course) => course.options.length > 0);

  return (
    <div className="card stock-portions-card">
      <div className="recipe-lines-toolbar" style={{ marginBottom: 12 }}>
        <strong>Courses the guest chooses</strong>
        <span style={{ flex: 1 }} />
        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing((value) => !value)}>
          {editing ? 'Done editing' : 'Edit courses'}
        </Button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {note ? <p className="subtle">{note}</p> : null}
      {courses === null ? <Spinner label="Loading courses" /> : null}

      {courses !== null && tonightRows.length === 0 && !editing ? (
        <p className="subtle">
          No courses yet. Add one and the register will ask the table who is having what — until then this menu rings as a
          plain price.
        </p>
      ) : null}

      {/* Tonight's menu: one tap per dish, saved immediately. */}
      {!editing && tonightRows.length > 0 ? (
        <div className="setmenu-tonight">
          {tonightRows.map((course) => (
            <div key={course.id} className="setmenu-tonight-course">
              <span className="setmenu-tonight-name">
                {course.name}
                <small>
                  {course.pick === 1 ? 'one each' : `${course.pick} each`}
                  {course.perGuests && course.perGuests > 1 ? `, shared between ${course.perGuests}` : ''}
                </small>
              </span>
              <div className="setmenu-tonight-dishes">
                {course.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={option.available ? 'is-on' : ''}
                    disabled={!canManage}
                    onClick={() => void toggleTonight(option.id, !option.available)}
                  >
                    {option.title}
                    {option.supplementCents > 0 ? ` +${formatCurrency(option.supplementCents / 100)}` : ''}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="subtle">Tap a dish to take it off tonight, tap again to put it back.</p>
        </div>
      ) : null}

      {editing ? (
        <>
          {drafts.map((draft, index) => (
            <div key={index} className="setmenu-course-edit">
              <div className="setmenu-course-head">
                <Input
                  label="Course"
                  value={draft.name}
                  placeholder="Entrée"
                  onChange={(event) => patchCourse(index, { name: event.currentTarget.value })}
                />
                <Input
                  label="Each guest picks"
                  type="number"
                  min={1}
                  max={9}
                  value={draft.pick}
                  onChange={(event) => patchCourse(index, { pick: event.currentTarget.value })}
                />
                <Input
                  label="Shared between"
                  type="number"
                  min={2}
                  max={40}
                  placeholder="Not shared"
                  value={draft.perGuests}
                  onChange={(event) => patchCourse(index, { perGuests: event.currentTarget.value })}
                />
                <Select
                  label="Fires as (POS course)"
                  value={draft.posCourse}
                  onChange={(event) => patchCourse(index, { posCourse: event.currentTarget.value })}
                  options={[
                    { value: '', label: 'Not set - the register decides' },
                    // A name typed in before this was a dropdown stays
                    // selectable, so opening the editor can never quietly
                    // change when a course fires.
                    ...(draft.posCourse && !POS_COURSE_NAMES.includes(draft.posCourse)
                      ? [{ value: draft.posCourse, label: draft.posCourse }]
                      : []),
                    ...POS_COURSE_NAMES.map((name) => ({ value: name, label: name }))
                  ]}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!canManage}
                  onClick={() => {
                    setDrafts((current) => current.filter((_, i) => i !== index));
                    setDirty(true);
                  }}
                >
                  Remove course
                </Button>
              </div>
              <table className="recipe-lines-table">
                <thead>
                  <tr>
                    <th>Dish</th>
                    <th>Supplement</th>
                    <th>On the menu</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {draft.options.map((option, optionIndex) => (
                    <tr key={`${option.recipeId}-${optionIndex}`}>
                      <td>{option.title}</td>
                      <td>
                        <input
                          className="recipe-line-input recipe-line-input-narrow"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={option.supplement}
                          onChange={(event) =>
                            patchCourse(index, {
                              options: draft.options.map((row, i) =>
                                i === optionIndex ? { ...row, supplement: event.currentTarget.value } : row
                              )
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={option.available}
                          onChange={(event) =>
                            patchCourse(index, {
                              options: draft.options.map((row, i) =>
                                i === optionIndex ? { ...row, available: event.currentTarget.checked } : row
                              )
                            })
                          }
                        />
                      </td>
                      <td className="cell-actions">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={!canManage}
                          onClick={() =>
                            patchCourse(index, { options: draft.options.filter((_, i) => i !== optionIndex) })
                          }
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {draft.options.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="subtle">
                        Nothing to choose from yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              <Select
                label="Add a dish to this course"
                value=""
                options={dishOptions}
                disabled={!canManage}
                onChange={(event) => addOption(index, event.currentTarget.value)}
              />
            </div>
          ))}
          <div className="recipe-lines-toolbar">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!canManage}
              onClick={() => {
                setDrafts((current) => [
                  ...current,
                  { id: null, name: '', posCourse: '', pick: '1', perGuests: '', options: [] }
                ]);
                setDirty(true);
              }}
            >
              Add course
            </Button>
            <span style={{ flex: 1 }} />
            <Button type="button" size="sm" disabled={!canManage || !dirty || saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save courses'}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function SetMenuComponentsPanel({
  menuId,
  canManage,
  onAdded
}: {
  menuId: string;
  canManage: boolean;
  onAdded: () => Promise<void> | void;
}) {
  const [components, setComponents] = useState<SetMenuComponentOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [shareDefault, setShareDefault] = useState('');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open || components !== null) return;
    void (async () => {
      try {
        setComponents(await api<SetMenuComponentOption[]>('/api/recipes/set-menu-components'));
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load Square components');
      }
    })();
  }, [open, components]);

  async function add(component: SetMenuComponentOption, allMenus: boolean) {
    if (!component.recipeId) return;
    setBusyId(`${component.mappingId}:${allMenus ? 'all' : 'one'}`);
    setNote(null);
    try {
      const result = await api<{ added: number; skipped: string[] }>('/api/recipes/set-menus/add-component', {
        method: 'POST',
        body: JSON.stringify({
          subRecipeId: component.recipeId,
          quantity: 1,
          perGuests: shareDefault ? Number(shareDefault) : undefined,
          ...(allMenus ? {} : { menuIds: [menuId] })
        })
      });
      setNote(
        `Added to ${result.added} menu${result.added === 1 ? '' : 's'}` +
          (result.skipped.length ? ` · already on ${result.skipped.join(', ')}` : '')
      );
      await onAdded();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Could not add component');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card stock-portions-card">
      <div className="recipe-lines-toolbar" style={{ marginBottom: open ? 12 : 0 }}>
        <strong>Square set-menu components (* items)</strong>
        <span style={{ flex: 1 }} />
        {open ? (
          <label className="subtle" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Add as shared between
            <select
              className="recipe-line-input recipe-line-input-narrow"
              value={shareDefault}
              onChange={(event) => setShareDefault(event.currentTarget.value)}
            >
              <option value="">Each guest</option>
              <option value="2">2 guests</option>
              <option value="4">4 guests</option>
              <option value="6">6 guests</option>
              <option value="8">8 guests</option>
            </select>
          </label>
        ) : null}
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show * items'}
        </Button>
      </div>
      {open ? (
        error ? (
          <p className="error-text">{error}</p>
        ) : components === null ? (
          <Spinner label="Loading Square components" />
        ) : components.length === 0 ? (
          <p className="subtle">No * or BB-prefixed items found in the Square menu mapping.</p>
        ) : (
          <>
            {note ? <p className="subtle">{note}</p> : null}
            <table className="recipe-lines-table">
              <thead>
                <tr>
                  <th>Square item</th>
                  <th>Venue</th>
                  <th>Mapped recipe</th>
                  <th>Cost</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {components.map((component) => (
                  <tr key={component.mappingId}>
                    <td>{component.squareItemName}</td>
                    <td>{component.venue ?? '—'}</td>
                    <td>
                      {component.mapped ? (
                        component.recipeTitle
                      ) : (
                        <Badge tone="warning">Not mapped — map it on the menu mapping page first</Badge>
                      )}
                    </td>
                    <td>
                      {component.recipeEstimatedCost !== null && component.recipeEstimatedCost > 0
                        ? formatCurrency(component.recipeEstimatedCost)
                        : '—'}
                    </td>
                    <td className="cell-actions">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!canManage || !component.mapped || busyId !== null}
                        onClick={() => void add(component, false)}
                      >
                        {busyId === `${component.mappingId}:one` ? 'Adding…' : 'Add to this menu'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!canManage || !component.mapped || busyId !== null}
                        onClick={() => void add(component, true)}
                      >
                        {busyId === `${component.mappingId}:all` ? 'Adding…' : 'All menus'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )
      ) : null}
    </div>
  );
}
