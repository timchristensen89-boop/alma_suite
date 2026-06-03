import { useEffect, useState } from 'react';
import type { RecipeCostPayload, RecipeWithLines } from '@alma/shared';
import { Spinner } from '@alma/ui';
import { stockApi } from '../lib/api';

function formatMoney(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2
  }).format(cents / 100);
}

// Read-only recipe popup for the reports app — opened by clicking a menu
// profitability row. Pulls the recipe + cost breakdown from the Stock API.
export function RecipePreviewModal({
  recipeId,
  fallbackTitle,
  onClose
}: {
  recipeId: string;
  fallbackTitle?: string | null;
  onClose: () => void;
}) {
  const [recipe, setRecipe] = useState<RecipeWithLines | null>(null);
  const [cost, setCost] = useState<RecipeCostPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        const [r, c] = await Promise.all([
          stockApi<RecipeWithLines>(`/api/recipes/${recipeId}`),
          stockApi<RecipeCostPayload>(`/api/recipes/${recipeId}/cost`).catch(() => null)
        ]);
        if (cancelled) return;
        setRecipe(r);
        setCost(c);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load recipe.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  const perPortionCents = cost
    ? cost.costPerPortionCents
    : recipe?.estimatedCost != null
      ? Math.round(recipe.estimatedCost * 100)
      : null;

  return (
    <div className="recipe-preview-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="recipe-preview" onClick={(event) => event.stopPropagation()}>
        <div className="recipe-preview-head">
          <h3>{recipe?.title ?? fallbackTitle ?? 'Recipe'}</h3>
          <button type="button" className="recipe-preview-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {loading ? <Spinner label="Loading recipe…" /> : null}
        {error ? <p className="error-text">{error}</p> : null}

        {!loading && !error && recipe ? (
          <>
            <div className="recipe-preview-meta">
              {recipe.venue ? <span>{recipe.venue}</span> : null}
              {recipe.category ? <span>{recipe.category}</span> : null}
            </div>

            <div className="recipe-preview-stats">
              <div>
                <span>Sell price</span>
                <strong>{formatMoney(recipe.salePriceCents)}</strong>
              </div>
              <div>
                <span>Cost / portion</span>
                <strong>{formatMoney(perPortionCents)}</strong>
              </div>
              {cost?.foodCostPercent != null ? (
                <div>
                  <span>Food cost</span>
                  <strong>{cost.foodCostPercent}%</strong>
                </div>
              ) : null}
            </div>

            {recipe.lines.length > 0 ? (
              <div className="recipe-preview-lines">
                <span className="recipe-preview-lines-label">Ingredients</span>
                {recipe.lines.map((line) => (
                  <div key={line.id} className="recipe-preview-line">
                    <span>{line.ingredientName}</span>
                    <span>
                      {line.quantity ?? '—'} {line.unit ?? ''}
                    </span>
                    <span>{formatMoney(line.cost != null ? Math.round(line.cost * 100) : null)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="subtle">No ingredient lines on this recipe yet.</p>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
