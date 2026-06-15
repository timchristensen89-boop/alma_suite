import { useCallback, useEffect, useState } from 'react';
import type { PortionParentType, PortionTreePayload } from '@alma/shared';
import { Badge, Button, Input } from '@alma/ui';
import { api } from '../../lib/api';

type DraftPortion = { name: string; size: string; unit: string; price: string };

const UNIT_OPTIONS: Record<'volume' | 'mass' | 'count', { label: string; value: string }[]> = {
  volume: [
    { label: 'mL', value: 'ml' },
    { label: 'L', value: 'l' }
  ],
  mass: [
    { label: 'g', value: 'g' },
    { label: 'kg', value: 'kg' }
  ],
  count: [{ label: 'Unit', value: 'unit' }]
};

function money(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Build the parent → child "serves" tree for a portioned product: a bottle/keg/
 * case (stock item) or a bulk production recipe yields child sellable recipes
 * (large/small glass, schooner/pint, bottle, single cocktail), each costed from
 * the parent. Add serves here and Alma creates the linked sellable recipes.
 */
export function PortionsBuilder({
  parentType,
  parentId,
  canManage
}: {
  parentType: PortionParentType;
  parentId: string;
  canManage: boolean;
}) {
  const [tree, setTree] = useState<PortionTreePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<DraftPortion[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api<PortionTreePayload>(
        `/api/recipes/portion-tree?parentType=${parentType}&parentId=${encodeURIComponent(parentId)}`
      );
      setTree(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load serves.');
    } finally {
      setLoading(false);
    }
  }, [parentType, parentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const unitOptions = UNIT_OPTIONS[tree?.parentUnitKind ?? 'count'];
  const defaultUnit = unitOptions[0]?.value ?? 'unit';

  function addRow() {
    setDrafts((current) => [...current, { name: '', size: '', unit: defaultUnit, price: '' }]);
  }
  function updateRow(index: number, patch: Partial<DraftPortion>) {
    setDrafts((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function removeRow(index: number) {
    setDrafts((current) => current.filter((_, i) => i !== index));
  }

  async function create() {
    const portions = drafts
      .filter((d) => d.name.trim().length >= 2 && Number(d.size) > 0)
      .map((d) => ({
        name: d.name.trim(),
        quantity: Number(d.size),
        unit: d.unit,
        salePriceCents: d.price.trim() !== '' && Number.isFinite(Number(d.price)) ? Math.round(Number(d.price) * 100) : undefined
      }));
    if (portions.length === 0) {
      setError('Add at least one serve with a name and a size.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api<PortionTreePayload>('/api/recipes/portions', {
        method: 'POST',
        body: JSON.stringify({ parentType, parentId, portions })
      });
      setTree(updated);
      setDrafts([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create serves.');
    } finally {
      setSaving(false);
    }
  }

  const sizeUnitHint = tree?.parentUnitKind === 'count' ? 'whole units' : tree?.parentUnitKind === 'mass' ? 'g / kg' : 'mL / L';

  return (
    <div className="portions-builder">
      <div className="portions-head">
        <strong>Serves &amp; portions{tree ? ` · ${tree.children.length}` : ''}</strong>
        <span className="subtle">Each serve is a sellable recipe costed from {tree?.parentLabel ?? 'this parent'}.</span>
      </div>

      {loading ? <p className="subtle">Loading serves…</p> : null}

      {!loading && tree && tree.children.length > 0 ? (
        <ul className="portions-tree">
          {tree.children.map((child) => (
            <li key={child.recipeId} className="portions-tree-row">
              <span className="portions-tree-name">
                {child.title}
                {child.portionLabel ? <span className="subtle"> · {child.portionLabel}</span> : null}
              </span>
              <span className="portions-tree-meta">
                <span>{money(child.costPerPortionCents)} cost</span>
                {child.salePriceCents != null ? <span>{money(child.salePriceCents)} sell</span> : null}
                {child.foodCostPercent != null ? <span>{child.foodCostPercent.toFixed(0)}% cost</span> : null}
                {child.squareMapped ? <Badge tone="positive">Square</Badge> : null}
                {child.warnings.length ? <Badge tone="warning">Check cost</Badge> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : !loading ? (
        <p className="subtle">No serves yet — add one below.</p>
      ) : null}

      {canManage ? (
        <div className="portions-add">
          {drafts.map((draft, index) => (
            <div key={index} className="portions-draft-row">
              <Input
                placeholder="Serve name (e.g. Large glass)"
                value={draft.name}
                onChange={(event) => updateRow(index, { name: event.currentTarget.value })}
              />
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder={`Size (${sizeUnitHint})`}
                value={draft.size}
                onChange={(event) => updateRow(index, { size: event.currentTarget.value })}
              />
              <select
                className="portions-unit-select"
                value={draft.unit}
                onChange={(event) => updateRow(index, { unit: event.currentTarget.value })}
              >
                {unitOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Sell $ (optional)"
                value={draft.price}
                onChange={(event) => updateRow(index, { price: event.currentTarget.value })}
              />
              <button type="button" className="portions-remove" aria-label="Remove serve" onClick={() => removeRow(index)}>×</button>
            </div>
          ))}
          <div className="portions-add-actions">
            <Button type="button" size="sm" variant="secondary" onClick={addRow} disabled={saving}>+ Add serve</Button>
            {drafts.length > 0 ? (
              <Button type="button" size="sm" onClick={() => void create()} disabled={saving}>
                {saving ? 'Creating…' : `Create ${drafts.length} serve${drafts.length === 1 ? '' : 's'}`}
              </Button>
            ) : null}
          </div>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
