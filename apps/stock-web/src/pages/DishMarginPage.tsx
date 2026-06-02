import { useEffect, useMemo, useState } from 'react';
import type { Recipe, RecipeCostPayload, RecipeWithLines, RecipesPayload } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner } from '@alma/ui';
import { api } from '../lib/api';

type MarginTone = 'positive' | 'warning' | 'danger' | 'muted';

function formatMoney(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2
  }).format(cents / 100);
}

function classifyMargin(grossMarginPercent: number | null): { tone: MarginTone; label: string } {
  if (grossMarginPercent == null) return { tone: 'muted', label: 'No data' };
  if (grossMarginPercent >= 70) return { tone: 'positive', label: 'Healthy' };
  if (grossMarginPercent >= 50) return { tone: 'warning', label: 'Watch' };
  return { tone: 'danger', label: 'Low margin' };
}

type EnrichedRecipe = Recipe & {
  costCents: number | null;
  sellCents: number | null;
  marginCents: number | null;
  marginPercent: number | null;
  foodCostPercent: number | null;
  /** quantitySold × marginCents — total margin contribution in the window. */
  contributionCents: number | null;
  hasVenueOverride: boolean;
};

const LOOKBACK_OPTIONS: Array<{ label: string; value: number }> = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 }
];

// Effective sell price for a recipe given the selected venue filter: when a
// specific venue is selected and that recipe has a per-venue override, use it;
// otherwise fall back to the recipe's default sale price.
function effectiveSellCents(recipe: Recipe, venueFilter: string): number | null {
  const override =
    venueFilter !== 'all'
      ? recipe.venuePrices?.find((p) => p.venue === venueFilter)?.salePriceCents ?? null
      : null;
  return override ?? recipe.salePriceCents ?? null;
}

export function DishMarginPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [venueFilter, setVenueFilter] = useState('all');
  const [tone, setTone] = useState<'all' | MarginTone>('all');
  const [search, setSearch] = useState('');
  const [lookbackDays, setLookbackDays] = useState<number>(30);
  // Quick view/edit popup — holds the id of the recipe being inspected.
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null);

  async function loadRecipes() {
    try {
      setLoading(true);
      // /api/recipes returns a RecipesPayload ({ recipes, categories,
      // recipeCategories }) — not a flat Recipe[] — so we have to pluck
      // the recipes array before filtering. Previously this blew up as
      // "j.filter is not a function" in the minified prod build.
      const payload = await api<RecipesPayload>(`/api/recipes?withSales=${lookbackDays}`);
      const list = Array.isArray(payload) ? payload : payload?.recipes ?? [];
      setRecipes(list.filter((r) => !r.isPrepRecipe));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load recipes');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        const payload = await api<RecipesPayload>(`/api/recipes?withSales=${lookbackDays}`);
        const list = Array.isArray(payload) ? payload : payload?.recipes ?? [];
        if (!cancelled) setRecipes(list.filter((r) => !r.isPrepRecipe));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load recipes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [lookbackDays]);

  const enriched = useMemo<EnrichedRecipe[]>(() => {
    return recipes.map((r) => {
      // `estimatedCost` is dollars (a number like 8.50); convert to cents.
      const costCents = typeof r.estimatedCost === 'number' && r.estimatedCost > 0
        ? Math.round(r.estimatedCost * 100)
        : null;
      const sellCents = effectiveSellCents(r, venueFilter);
      const hasVenueOverride =
        venueFilter !== 'all' &&
        (r.venuePrices?.some((p) => p.venue === venueFilter) ?? false);
      let marginCents: number | null = null;
      let marginPercent: number | null = null;
      let foodCostPercent: number | null = null;
      if (costCents != null && sellCents != null && sellCents > 0) {
        marginCents = sellCents - costCents;
        marginPercent = (marginCents / sellCents) * 100;
        foodCostPercent = (costCents / sellCents) * 100;
      }
      const quantitySold = r.actualSales?.quantitySold ?? 0;
      const contributionCents = marginCents != null && quantitySold > 0
        ? Math.round(marginCents * quantitySold)
        : null;
      return { ...r, costCents, sellCents, marginCents, marginPercent, foodCostPercent, contributionCents, hasVenueOverride };
    });
  }, [recipes, venueFilter]);

  const venues = useMemo(() => Array.from(new Set(enriched.map((r) => r.venue).filter(Boolean))) as string[], [enriched]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return enriched
      .filter((r) => venueFilter === 'all' || r.venue === venueFilter)
      .filter((r) => {
        if (tone === 'all') return true;
        const { tone: rowTone } = classifyMargin(r.marginPercent);
        return rowTone === tone;
      })
      .filter((r) => !term || r.title.toLowerCase().includes(term))
      .sort((a, b) => {
        if (a.marginPercent == null) return 1;
        if (b.marginPercent == null) return -1;
        return a.marginPercent - b.marginPercent;
      });
  }, [enriched, venueFilter, tone, search]);

  const summary = useMemo(() => {
    const totals = { positive: 0, warning: 0, danger: 0, muted: 0 };
    for (const r of enriched) {
      totals[classifyMargin(r.marginPercent).tone] += 1;
    }
    const withData = enriched.filter((r) => r.marginPercent != null);
    const avgMargin = withData.length
      ? withData.reduce((sum, r) => sum + (r.marginPercent ?? 0), 0) / withData.length
      : null;
    return { totals, avgMargin, totalRecipes: enriched.length };
  }, [enriched]);

  if (loading) {
    return (
      <Card title="Dish margins"><Spinner label="Loading recipes…" /></Card>
    );
  }

  if (error) {
    return (
      <Card title="Dish margins">
        <p className="error-text">{error}</p>
      </Card>
    );
  }

  return (
    <div className="dish-margin-stack">
      <Card
        title="Dish margins"
        subtitle="Recipe cost vs sell price across the menu — sorted by lowest margin first"
      >
        <div className="dish-margin-summary">
          <div className="dish-margin-summary-tile is-positive">
            <strong>{summary.totals.positive}</strong>
            <span>Healthy (≥70% margin)</span>
          </div>
          <div className="dish-margin-summary-tile is-warning">
            <strong>{summary.totals.warning}</strong>
            <span>Watch (50–69%)</span>
          </div>
          <div className="dish-margin-summary-tile is-danger">
            <strong>{summary.totals.danger}</strong>
            <span>Low margin (&lt;50%)</span>
          </div>
          <div className="dish-margin-summary-tile is-muted">
            <strong>{summary.totals.muted}</strong>
            <span>No cost or sell price set</span>
          </div>
          <div className="dish-margin-summary-tile is-info">
            <strong>{summary.avgMargin != null ? `${summary.avgMargin.toFixed(0)}%` : '—'}</strong>
            <span>Average margin</span>
          </div>
        </div>

        <div className="dish-margin-filters">
          <Input
            label="Search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Recipe title"
          />
          <Select
            label="Venue"
            value={venueFilter}
            onChange={(event) => setVenueFilter(event.currentTarget.value)}
            options={[
              { label: 'All venues', value: 'all' },
              ...venues.map((v) => ({ label: v, value: v }))
            ]}
          />
          <Select
            label="Filter by tone"
            value={tone}
            onChange={(event) => setTone(event.currentTarget.value as 'all' | MarginTone)}
            options={[
              { label: 'All', value: 'all' },
              { label: 'Low margin only', value: 'danger' },
              { label: 'Watch only', value: 'warning' },
              { label: 'Healthy only', value: 'positive' },
              { label: 'Missing data', value: 'muted' }
            ]}
          />
          <Select
            label="Sales window"
            value={String(lookbackDays)}
            onChange={(event) => setLookbackDays(Number(event.currentTarget.value))}
            options={LOOKBACK_OPTIONS.map((opt) => ({ label: opt.label, value: String(opt.value) }))}
          />
        </div>

        {(() => {
          const unmapped = recipes.filter((r) => !r.actualSales || !r.actualSales.hasMapping).length;
          if (unmapped === 0 || recipes.length === 0) return null;
          return (
            <p className="dish-margin-unmapped-note subtle">
              {unmapped} of {recipes.length} dishes have no Square sales mapped, so their sold
              quantity and contribution read “Not mapped to Square” rather than a number. Map a
              recipe to its Square item to see sales-weighted margins and feed the dashboard’s
              theoretical COGS.
            </p>
          );
        })()}

        {filtered.length === 0 ? (
          <EmptyState
            title="No recipes match"
            description="Adjust the filters or check that recipes have sell prices and ingredient costs set."
          />
        ) : (
          <div className="dish-margin-table">
            <div className="dish-margin-row dish-margin-head">
              <span>Dish</span>
              <span>Venue</span>
              <span>Cost</span>
              <span>Sell price</span>
              <span>Margin</span>
              <span>Sold ({lookbackDays}d)</span>
              <span>Revenue ({lookbackDays}d)</span>
              <span>Contribution</span>
              <span>Status</span>
            </div>
            {filtered.map((r) => {
              const meta = classifyMargin(r.marginPercent);
              const sales = r.actualSales;
              const soldDisplay = sales
                ? sales.quantitySold > 0
                  ? sales.quantitySold.toLocaleString()
                  : sales.hasMapping ? '0' : <small className="dish-margin-no-mapping">Not mapped to Square</small>
                : '—';
              return (
                <div
                  key={r.id}
                  className={`dish-margin-row dish-margin-row--clickable is-${meta.tone}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveRecipeId(r.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setActiveRecipeId(r.id);
                    }
                  }}
                >
                  <span className="dish-margin-title">
                    <strong>{r.title}</strong>
                    {r.category ? <small>{r.category}</small> : null}
                  </span>
                  <span>{r.venue || '—'}</span>
                  <span>{formatMoney(r.costCents)}</span>
                  <span>
                    {formatMoney(r.sellCents)}
                    {r.hasVenueOverride ? <small className="dish-margin-venue-tag"> per-venue</small> : null}
                  </span>
                  <span>
                    {r.marginCents != null ? (
                      <>
                        {formatMoney(r.marginCents)}
                        {r.marginPercent != null ? <small> ({r.marginPercent.toFixed(0)}%)</small> : null}
                      </>
                    ) : '—'}
                  </span>
                  <span>{soldDisplay}</span>
                  <span>{sales && sales.quantitySold > 0 ? formatMoney(sales.netSalesCents) : '—'}</span>
                  <span>{formatMoney(r.contributionCents)}</span>
                  <span><Badge tone={meta.tone}>{meta.label}</Badge></span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {activeRecipeId ? (
        <DishDetailModal
          recipeId={activeRecipeId}
          onClose={() => setActiveRecipeId(null)}
          onSaved={() => {
            setActiveRecipeId(null);
            void loadRecipes();
          }}
        />
      ) : null}
    </div>
  );
}

// ── Quick view / edit popup ─────────────────────────────────────────────
// Loads the full recipe (with ingredient lines) + its cost breakdown, lets a
// manager set the sell price / estimated cost inline, and lists ingredient
// lines so they can sanity-check what's driving the cost. Saves via
// PATCH /api/recipes/:id, then asks the page to refresh.

function DishDetailModal({
  recipeId,
  onClose,
  onSaved
}: {
  recipeId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [recipe, setRecipe] = useState<RecipeWithLines | null>(null);
  const [cost, setCost] = useState<RecipeCostPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [salePrice, setSalePrice] = useState('');
  const [estimatedCost, setEstimatedCost] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        const [r, c] = await Promise.all([
          api<RecipeWithLines>(`/api/recipes/${recipeId}`),
          api<RecipeCostPayload>(`/api/recipes/${recipeId}/cost`).catch(() => null)
        ]);
        if (cancelled) return;
        setRecipe(r);
        setCost(c);
        setSalePrice(r.salePriceCents == null ? '' : String(r.salePriceCents / 100));
        setEstimatedCost(r.estimatedCost ? String(r.estimatedCost) : '');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load dish');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [recipeId]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api<RecipeWithLines>(`/api/recipes/${recipeId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          salePriceCents: salePrice === '' ? undefined : Math.round(Number(salePrice) * 100),
          estimatedCost: estimatedCost === '' ? undefined : Number(estimatedCost)
        })
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setSaving(false);
    }
  }

  return (
    <div className="dish-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="dish-modal" onClick={(event) => event.stopPropagation()}>
        <div className="dish-modal-head">
          <h3>{recipe?.title ?? 'Dish'}</h3>
          <button type="button" className="dish-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {loading ? (
          <Spinner label="Loading dish…" />
        ) : (
          <>
            {error ? <p className="error-text">{error}</p> : null}
            <div className="dish-modal-meta">
              {recipe?.venue ? <span>{recipe.venue}</span> : null}
              {recipe?.category ? <span>{recipe.category}</span> : null}
            </div>

            <div className="dish-modal-fields">
              <Input
                label="Sell price ($)"
                type="number"
                value={salePrice}
                onChange={(event) => setSalePrice(event.currentTarget.value)}
                placeholder="e.g. 24.00"
              />
              <Input
                label="Estimated cost ($)"
                type="number"
                value={estimatedCost}
                onChange={(event) => setEstimatedCost(event.currentTarget.value)}
                placeholder="e.g. 8.50"
              />
            </div>

            {cost ? (
              <div className="dish-modal-cost">
                <span>Batch cost: {formatMoney(cost.batchCostCents)}</span>
                <span>Per portion: {formatMoney(cost.costPerPortionCents)}</span>
                {cost.foodCostPercent != null ? <span>Food cost: {cost.foodCostPercent}%</span> : null}
              </div>
            ) : null}

            {recipe && recipe.lines.length > 0 ? (
              <div className="dish-modal-lines">
                <span className="dish-modal-lines-label">Ingredients</span>
                {recipe.lines.map((line) => (
                  <div key={line.id} className="dish-modal-line">
                    <span>{line.ingredientName}</span>
                    <span>{line.quantity ?? '—'} {line.unit ?? ''}</span>
                    <span>{formatMoney(line.cost != null ? Math.round(line.cost * 100) : null)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="dish-modal-empty">No ingredient lines yet. Add them in Recipes to drive the cost automatically.</p>
            )}

            <div className="dish-modal-actions">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="button" onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
