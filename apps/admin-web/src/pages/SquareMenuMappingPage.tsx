import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  SquareAccountKey,
  SquareMenuMappingPayload,
  SquareMenuMappingStatus,
  SquareMenuRecipeMapping,
  SquareMenuRecipeOptionsPayload,
  SquareMenuMappingSyncResult,
  SquareMenuAutoMatchResult
} from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner } from '@alma/ui';
import { api } from '../../../web/src/lib/api';

const ACCOUNT_LABELS: Record<SquareAccountKey, string> = {
  primary: 'Primary / St Alma',
  secondary: 'Secondary / Alma Avalon'
};

const ACCOUNT_OPTIONS = [
  { value: 'primary', label: ACCOUNT_LABELS.primary },
  { value: 'secondary', label: ACCOUNT_LABELS.secondary }
];

const STATUS_OPTIONS: Array<{ value: '' | SquareMenuMappingStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'UNMAPPED', label: 'Unmapped' },
  { value: 'NEEDS_REVIEW', label: 'Needs review' },
  { value: 'MAPPED', label: 'Mapped' },
  { value: 'IGNORED', label: 'Ignored' }
];

function money(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return 'Not available';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2
  }).format(cents / 100);
}

function recipeCost(recipeCost: number | null | undefined) {
  if (recipeCost === null || recipeCost === undefined) return 'Cost not available';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2
  }).format(recipeCost);
}

function statusTone(status: SquareMenuMappingStatus): 'positive' | 'warning' | 'muted' | 'info' {
  if (status === 'MAPPED') return 'positive';
  if (status === 'NEEDS_REVIEW') return 'warning';
  if (status === 'IGNORED') return 'muted';
  return 'info';
}

function mappingStatusLabel(status: SquareMenuMappingStatus | null | undefined) {
  return (status ?? 'UNMAPPED').replace(/_/g, ' ');
}

function marginLabel(mapping: SquareMenuRecipeMapping) {
  const margin = mapping.margin;
  if (!margin) return 'Not available';
  if (margin.grossProfitCents === null || margin.foodCostPercent === null) return 'Not available';
  return `${money(margin.grossProfitCents)} GP · ${(margin.foodCostPercent * 100).toFixed(1)}% food cost`;
}

export function SquareMenuMappingPage() {
  const [accountKey, setAccountKey] = useState<SquareAccountKey>('primary');
  const [status, setStatus] = useState<'' | SquareMenuMappingStatus>('UNMAPPED');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [payload, setPayload] = useState<SquareMenuMappingPayload | null>(null);
  const [options, setOptions] = useState<SquareMenuRecipeOptionsPayload | null>(null);
  const [selectedRecipes, setSelectedRecipes] = useState<Record<string, string>>({});
  const [selectedStockItems, setSelectedStockItems] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [autoMatching, setAutoMatching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadMappings(next?: { accountKey?: SquareAccountKey; status?: '' | SquareMenuMappingStatus; search?: string; category?: string }) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        accountKey: next?.accountKey ?? accountKey
      });
      const nextStatus = next?.status ?? status;
      const nextSearch = next?.search ?? search;
      const nextCategory = next?.category ?? category;
      if (nextStatus) params.set('status', nextStatus);
      if (nextSearch) params.set('search', nextSearch);
      if (nextCategory) params.set('category', nextCategory);
      const [nextPayload, nextOptions] = await Promise.all([
        api<SquareMenuMappingPayload>(`/api/menu-mappings/square?${params.toString()}`),
        options ? Promise.resolve(options) : api<SquareMenuRecipeOptionsPayload>('/api/menu-mappings/recipe-options')
      ]);
      setPayload(nextPayload);
      setOptions(nextOptions);
      setSelectedRecipes(Object.fromEntries(nextPayload.mappings.map((mapping) => [mapping.id, mapping.almaRecipeId ?? ''])));
      setSelectedStockItems(Object.fromEntries(nextPayload.mappings.map((mapping) => [mapping.id, mapping.stockItemId ?? ''])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Square menu mappings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMappings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitFilters(event: FormEvent) {
    event.preventDefault();
    void loadMappings();
  }

  async function syncCatalog() {
    setSyncing(true);
    setMessage(null);
    setError(null);
    try {
      const result = await api<SquareMenuMappingSyncResult>('/api/menu-mappings/square/sync', {
        method: 'POST',
        body: JSON.stringify({ accountKey })
      });
      setMessage(`${result.label}: ${result.catalogItemsRead} Square items read, ${result.mappingsCreated} new mapping candidates, ${result.mappingsPreserved} existing mappings preserved.`);
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sync Square catalogue.');
    } finally {
      setSyncing(false);
    }
  }

  async function autoMatchCatalog() {
    setAutoMatching(true);
    setMessage(null);
    setError(null);
    try {
      const result = await api<SquareMenuAutoMatchResult>('/api/menu-mappings/square/auto-match', {
        method: 'POST',
        body: JSON.stringify({ accountKey })
      });
      setMessage(
        `${ACCOUNT_LABELS[result.accountKey]} auto-match reviewed ${result.reviewed} rows: ${result.mapped} mapped, ${result.needsReview} needs review, ${result.unchanged} unchanged.`
      );
      if (result.needsReview > 0) setStatus('NEEDS_REVIEW');
      await loadMappings({ status: result.needsReview > 0 ? 'NEEDS_REVIEW' : status });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not auto-match Square menu items.');
    } finally {
      setAutoMatching(false);
    }
  }

  async function updateMapping(mapping: SquareMenuRecipeMapping, patch?: Partial<{ status: SquareMenuMappingStatus; clear: boolean }>) {
    setSavingId(mapping.id);
    setMessage(null);
    setError(null);
    try {
      if (patch?.clear) {
        await api(`/api/menu-mappings/square/${mapping.id}/clear`, { method: 'POST' });
      } else if (patch?.status === 'IGNORED') {
        await api(`/api/menu-mappings/square/${mapping.id}/ignore`, { method: 'POST' });
      } else {
        await api(`/api/menu-mappings/square/${mapping.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            almaRecipeId: selectedRecipes[mapping.id] || null,
            stockItemId: selectedStockItems[mapping.id] || null,
            status: patch?.status ?? (selectedRecipes[mapping.id] || selectedStockItems[mapping.id] ? 'MAPPED' : 'NEEDS_REVIEW')
          })
        });
      }
      setMessage('Mapping saved.');
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save mapping.');
    } finally {
      setSavingId(null);
    }
  }

  const recipes = options?.recipes ?? [];
  const stockItems = options?.stockItems ?? [];
  const categories = useMemo(() => payload?.categories ?? [], [payload]);
  const categoryOptions = useMemo(
    () => [{ value: '', label: 'All categories' }, ...categories.map((name) => ({ value: name, label: name }))],
    [categories]
  );

  return (
    <div className="page-stack square-menu-mapping-page">
      <Card
        title="Square Menu Mapping"
        subtitle="Match Square catalogue items to Alma recipes so future Reports and Stock workflows can calculate recipe-level COGS and menu profitability."
        action={
          <div className="admin-row-actions">
            <Button type="button" variant="secondary" onClick={autoMatchCatalog} disabled={autoMatching || syncing || loading}>
              {autoMatching ? 'Matching...' : 'Auto-match best guesses'}
            </Button>
            <Button type="button" onClick={syncCatalog} disabled={syncing || autoMatching}>{syncing ? 'Syncing...' : 'Sync Square menu'}</Button>
          </div>
        }
      >
        <form className="square-menu-toolbar" onSubmit={submitFilters}>
          <Select
            label="Square account"
            value={accountKey}
            options={ACCOUNT_OPTIONS}
            onChange={(event) => {
              const next = event.currentTarget.value as SquareAccountKey;
              setAccountKey(next);
              void loadMappings({ accountKey: next });
            }}
          />
          <Input label="Search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Square item or Alma recipe" />
          <Select
            label="Status"
            value={status}
            options={STATUS_OPTIONS}
            onChange={(event) => setStatus(event.currentTarget.value as '' | SquareMenuMappingStatus)}
          />
          <Select
            label="Category"
            value={category}
            options={categoryOptions}
            onChange={(event) => setCategory(event.currentTarget.value)}
          />
          <Button type="submit" variant="secondary" disabled={loading}>Apply filters</Button>
        </form>
        <details className="admin-collapsible square-menu-help">
          <summary>Mapping rules and data quality</summary>
          <div className="settings-panel">
            <p>Syncing creates unmapped candidates from Square. Manual mappings are preserved on resync. Auto-match applies high-confidence recipe or stock item matches and sends lower-confidence matches to review.</p>
            <p>Recipe cost uses the current Alma recipe estimated cost. If a recipe has no costing, the margin fields stay unavailable.</p>
          </div>
        </details>
        {message ? <p className="success-text">{message}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
      </Card>

      {payload ? (
        <div className="stats-grid report-metric-grid square-menu-summary">
          <Card padding="tight"><strong>{payload.summary.total}</strong><span>Total Square rows</span></Card>
          <Card padding="tight"><strong>{payload.summary.mapped}</strong><span>Mapped</span></Card>
          <Card padding="tight"><strong>{payload.summary.unmapped}</strong><span>Unmapped</span></Card>
          <Card padding="tight"><strong>{payload.summary.needsReview}</strong><span>Needs review</span></Card>
          <Card padding="tight"><strong>{payload.summary.ignored}</strong><span>Ignored</span></Card>
        </div>
      ) : null}

      {loading && !payload ? <Spinner label="Loading mappings..." /> : null}

      {payload && !payload.mappings.length ? (
        <EmptyState
          title="No Square menu items yet"
          description="Sync a connected Square account to create mapping candidates, then match each menu item to an Alma recipe."
        />
      ) : null}

      {payload?.mappings.length ? (
        <div className="square-menu-card-list">
          {payload.mappings.map((mapping) => (
            <Card
              key={mapping.id}
              className="square-menu-row-card"
              title={
                <span className="square-menu-title">
                  {mapping.squareItemName || 'Unnamed Square item'}
                  {mapping.squareVariationName ? <small>{mapping.squareVariationName}</small> : null}
                </span>
              }
              subtitle={`${mapping.categoryName ?? 'Uncategorised'} · ${money(mapping.priceMoneyAmount)}`}
              action={<Badge tone={statusTone(mapping.status ?? 'UNMAPPED')}>{mappingStatusLabel(mapping.status)}</Badge>}
            >
              <div className="square-menu-row-layout">
                <div className="square-menu-current">
                  <strong>Current mapping</strong>
                  <span>{mapping.almaRecipe ? mapping.almaRecipe.title : mapping.stockItem ? mapping.stockItem.name : 'Not mapped'}</span>
                  <small>
                    Recipe cost: {recipeCost(mapping.almaRecipe?.estimatedCost)} · Margin: {marginLabel(mapping)}
                  </small>
                </div>
                <label className="field">
                  <span>Alma recipe</span>
                  <select value={selectedRecipes[mapping.id] ?? ''} onChange={(event) => { const value = event.currentTarget.value; setSelectedRecipes((current) => ({ ...current, [mapping.id]: value })); }}>
                    <option value="">No recipe selected</option>
                    {recipes.map((recipe) => (
                      <option key={recipe.id} value={recipe.id}>
                        {recipe.title} {recipe.venue ? `· ${recipe.venue}` : ''} · {recipeCost(recipe.estimatedCost)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Stock item fallback</span>
                  <select value={selectedStockItems[mapping.id] ?? ''} onChange={(event) => { const value = event.currentTarget.value; setSelectedStockItems((current) => ({ ...current, [mapping.id]: value })); }}>
                    <option value="">No stock item selected</option>
                    {stockItems.map((item) => (
                      <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>
                    ))}
                  </select>
                </label>
                <div className="admin-row-actions square-menu-actions">
                  <Button type="button" onClick={() => updateMapping(mapping)} disabled={savingId === mapping.id}>Save mapping</Button>
                  <Button type="button" variant="secondary" onClick={() => updateMapping(mapping, { status: 'IGNORED' })} disabled={savingId === mapping.id}>Ignore</Button>
                  <Button type="button" variant="ghost" onClick={() => updateMapping(mapping, { clear: true })} disabled={savingId === mapping.id}>Clear</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
