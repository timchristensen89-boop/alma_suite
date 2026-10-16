import { useMemo, useState } from 'react';
import type { StocktakePrepRecipeOption } from '@alma/shared';
import { Button } from '@alma/ui';

/**
 * Adding prepped items to a count sheet.
 *
 * Prep is not a StockItem and never resolves from a count area or a category,
 * so it cannot arrive the way everything else on the sheet does. It has to be
 * chosen — which is also the honest thing, because a venue with 69 production
 * recipes does not count all 69 every week.
 *
 * Recipes that CANNOT be exploded are still listed, disabled, with the reason.
 * Hiding them is how this feature would come to look like it works: the mole
 * simply never appears and nobody can say why.
 */
export function PreppedItemsPicker({
  recipes,
  lines,
  onAdd
}: {
  recipes: StocktakePrepRecipeOption[];
  lines: Array<{ recipeId: string | null }>;
  onAdd: (chosen: StocktakePrepRecipeOption[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const alreadyOn = useMemo(
    () => new Set(lines.map((line) => line.recipeId).filter(Boolean)),
    [lines]
  );
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState('');

  const available = recipes.filter((recipe) => !alreadyOn.has(recipe.id));
  const countable = available.filter((recipe) => recipe.countable);
  const blocked = available.filter((recipe) => !recipe.countable);
  const onSheet = recipes.filter((recipe) => alreadyOn.has(recipe.id));

  // One flat list of ninety is a kitchen list a bar manager has to read
  // through to find two batches. The recipes already carry their category, so
  // group by it: the bar count opens on "Batches", the kitchen on its sauces,
  // and neither has to scroll past the other.
  const needle = filter.trim().toLowerCase();
  const matching = needle
    ? countable.filter(
        (recipe) =>
          recipe.title.toLowerCase().includes(needle) ||
          (recipe.category ?? '').toLowerCase().includes(needle)
      )
    : countable;
  const byCategory = new Map<string, StocktakePrepRecipeOption[]>();
  for (const recipe of matching) {
    const key = recipe.category?.trim() || 'Uncategorised';
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(recipe);
    else byCategory.set(key, [recipe]);
  }
  const groups = [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  if (recipes.length === 0) return null;

  function add(chosen: StocktakePrepRecipeOption[]) {
    if (chosen.length === 0) return;
    onAdd(chosen);
    setPicked(new Set());
  }

  return (
    <div className="stocktake-prep-picker">
      <button
        type="button"
        className={`stocktake-category-header${open ? ' is-open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="stocktake-category-name">
          {open ? '▾' : '▸'} Prepped items — count what the kitchen has made
        </span>
        <span className="stocktake-category-count">
          {onSheet.length} on this sheet · {countable.length} to add
        </span>
      </button>
      {open ? (
        <div className="stocktake-prep-body">
          <p className="subtle">
            Counted as the made item (kg, litres, portions). Approving the count works the
            ingredients out and adds them to those items’ counts — the mayonnaise in a tub of
            chipotle mayo stops reading as shrinkage.
          </p>
          {countable.length > 0 ? (
            <>
              <input
                type="search"
                className="stocktake-prep-filter"
                placeholder={`Filter ${countable.length} prepped items — batch, salsa, mole…`}
                value={filter}
                onChange={(event) => setFilter(event.currentTarget.value)}
                aria-label="Filter prepped items"
              />
              {groups.length === 0 ? (
                <p className="subtle">Nothing matches “{filter}”.</p>
              ) : null}
              {groups.map(([category, inCategory]) => (
                <div key={category} className="stocktake-prep-group">
                  <div className="stocktake-prep-group-head">
                    <strong>{category}</strong>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => add(inCategory)}
                    >
                      Add all {inCategory.length}
                    </Button>
                  </div>
                  <div className="stocktake-prep-grid">
                {inCategory.map((recipe) => (
                  <label
                    key={recipe.id}
                    className={`stocktake-prep-option${picked.has(recipe.id) ? ' is-picked' : ''}`}
                    title={recipe.warnings?.length ? recipe.warnings.join(' ') : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(recipe.id)}
                      onChange={(event) => {
                        // Read `checked` HERE, not inside the updater. React
                        // nulls currentTarget once the handler returns, and a
                        // set-state updater runs later, during render — so
                        // reading it in there threw and took the whole count
                        // sheet down to the error boundary the moment anyone
                        // ticked a prepped item.
                        const checked = event.currentTarget.checked;
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(recipe.id);
                          else next.delete(recipe.id);
                          return next;
                        });
                      }}
                    />
                    <span className="stocktake-prep-option-text">
                      <strong>{recipe.title}</strong>
                      {recipe.yieldQuantity ? (
                        <span className="subtle">
                          makes {recipe.yieldQuantity} {recipe.yieldUnit ?? ''}
                        </span>
                      ) : null}
                      {/* Countable, but it will book less than everything. Said
                          here rather than after the count, when the number is
                          already in the ledger — but as a count, with the
                          sentences on the label's title. Spelled out inline,
                          ninety of these is a wall of prose nobody reads. */}
                      {recipe.warnings?.length ? (
                        <span className="stocktake-prep-option-warn">
                          {recipe.warnings.length} ingredient issue
                          {recipe.warnings.length === 1 ? '' : 's'} — books less than everything
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
                  </div>
                </div>
              ))}
              <div className="stocktake-count-toggles">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={picked.size === 0}
                  onClick={() => add(countable.filter((recipe) => picked.has(recipe.id)))}
                >
                  Add {picked.size || ''} selected
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => add(countable)}>
                  Add all {countable.length}
                </Button>
              </div>
            </>
          ) : (
            <p className="subtle">Every countable prep recipe is already on this sheet.</p>
          )}
          {blocked.length > 0 ? (
            <div className="stocktake-prep-blocked">
              <strong>Not countable yet ({blocked.length})</strong>
              <p className="subtle">
                A count of these would book nothing at all — no batch yield, or not one
                ingredient linked to a stock item. Fix the recipe and they appear above.
              </p>
              <ul>
                {blocked.map((recipe) => (
                  <li key={recipe.id}>
                    <strong>{recipe.title}</strong> — {recipe.problems.join(' ')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

