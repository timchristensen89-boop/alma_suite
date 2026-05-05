import { useEffect, useState } from 'react';
import type { StockItemsSummary } from '@alma/shared';
import { Card, StatCard } from '@alma/ui';
import { IconItems, IconRecipes, IconStocktake, IconSuppliers } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { api } from '../lib/api';

function formatQuantity(value: number | null | undefined) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2
  }).format(value ?? 0);
}

export function DashboardPage() {
  useDocumentTitle('Overview');
  const [summary, setSummary] = useState<StockItemsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      try {
        const nextSummary = await api<StockItemsSummary>('/api/items/summary');
        if (!cancelled) setSummary(nextSummary);
      } catch {
        if (!cancelled) setSummary(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSummary();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page-stack">
      <Card
        title="Welcome to ALMA Suites Stock"
        subtitle="Central inventory for your venues — items, stocktake, suppliers and recipes in one place."
      >
        <p className="subtle">
          Track catalogue items, watch par levels, and build the stocktake
          workflow from one operational view.
        </p>
      </Card>

      <div className="stat-grid">
        <StatCard
          icon={<IconItems size={18} />}
          label="Items tracked"
          value={loading ? '—' : String(summary?.activeItems ?? 0)}
          hint={`${summary?.categories ?? 0} categories`}
        />
        <StatCard
          icon={<IconStocktake size={18} />}
          label="Low stock"
          value={loading ? '—' : String(summary?.lowStockItems ?? 0)}
          hint="At or below reorder point"
        />
        <StatCard
          icon={<IconSuppliers size={18} />}
          label="On hand"
          value={loading ? '—' : formatQuantity(summary?.totalOnHand)}
          hint="Total units across active items"
        />
        <StatCard
          icon={<IconRecipes size={18} />}
          label="Recipes"
          value="—"
          hint="Define prep recipes to drive sales depletion"
        />
      </div>
    </div>
  );
}
