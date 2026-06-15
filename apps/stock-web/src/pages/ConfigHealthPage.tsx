import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StockConfigHealthItem, StockConfigHealthPayload } from '@alma/shared';
import { Badge, Card, EmptyState, Spinner, StatCard } from '@alma/ui';
import { IconItems } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';

function money(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

const ISSUE_LABEL: Record<string, string> = {
  'no-avg-cost': 'No cost',
  'recipe-unit-mismatch': 'Recipe unit',
  'measure-half-set': 'Measure bridge',
  'stale-cost': 'Stale cost'
};

function HealthRow({ item }: { item: StockConfigHealthItem }) {
  return (
    <li className={`config-health-row is-${item.topSeverity}`}>
      <div className="config-health-row-head">
        <div className="config-health-row-title">
          <Link className="config-health-row-name" to={`/items?edit=${encodeURIComponent(item.id)}`}>
            {item.name}
          </Link>
          {item.categoryName ? <span className="config-health-row-cat">{item.categoryName}</span> : null}
        </div>
        <div className="config-health-row-meta">
          {item.recipeCount > 0 ? (
            <span>{item.recipeCount} recipe{item.recipeCount === 1 ? '' : 's'}</span>
          ) : null}
          {item.onHandValueCents != null ? <span>{money(item.onHandValueCents)} on hand</span> : null}
        </div>
      </div>
      <ul className="config-health-issues">
        {item.issues.map((issue, index) => (
          <li key={index} className={`config-health-issue is-${issue.severity}`}>
            <Badge tone={issue.severity === 'error' ? 'danger' : 'warning'}>
              {ISSUE_LABEL[issue.code] ?? issue.code}
            </Badge>
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
      <div className="config-health-row-actions">
        <Link className="config-health-fix" to={`/items?edit=${encodeURIComponent(item.id)}`}>
          Fix this item →
        </Link>
      </div>
    </li>
  );
}

export function ConfigHealthPage() {
  useDocumentTitle('Costing health');
  const [data, setData] = useState<StockConfigHealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<StockConfigHealthPayload>('/api/items/config-health')
      .then((payload) => {
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load costing health.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (loading && !data) {
    return (
      <div className="page-loading">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="config-health-page">
      <Card
        title="Costing health"
        subtitle="Active items mis-configured so they cost $0 or wrong in recipes and stock value — worst impact first. Fix these and every number downstream gets more honest."
        action={
          <button type="button" className="btn btn-ghost" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      >
        {error ? <p className="config-health-error">{error}</p> : null}

        {data ? (
          <>
            <div className="config-health-stats">
              <StatCard label="Items to fix" value={String(data.flaggedCount)} icon={<IconItems size={18} />} />
              <StatCard label="Breaking costs" value={String(data.errorItemCount)} tone={data.errorItemCount > 0 ? 'danger' : 'neutral'} />
              <StatCard label="Worth a check" value={String(data.warnItemCount)} tone={data.warnItemCount > 0 ? 'warning' : 'neutral'} />
              <StatCard label="Active items" value={String(data.totalActiveItems)} />
            </div>

            {data.items.length === 0 ? (
              <EmptyState
                title="Everything's costing cleanly"
                description="No active item is missing a cost, half-configured, or used in a recipe with a unit that can't convert. Stock value and recipe costs are reading from a clean base."
              />
            ) : (
              <ul className="config-health-list">
                {data.items.map((item) => (
                  <HealthRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </>
        ) : null}
      </Card>
    </div>
  );
}
