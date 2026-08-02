import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Spinner, StatCard } from '@alma/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useStickyVenue } from '../hooks/useStickyVenue';
import { ApiError, api } from '../lib/api';

type PurchaseFacts = {
  supplierId: string | null;
  supplierName: string | null;
  supplierShare: number;
  lastPriceCents: number | null;
  lastPurchasedAt: string | null;
  lowPriceCents: number | null;
  highPriceCents: number | null;
  priceMovement: number | null;
  purchaseCount: number;
  totalQuantity: number;
};

type BuyingItem = {
  id: string;
  name: string;
  unit: string | null;
  countUnit: string | null;
  conversionFactor: number;
  category: { id: string; name: string } | null;
  onHand: number;
  parLevel: number;
  reorderPoint: number | null;
  latestCostCents: number | null;
  latestCostAt: string | null;
  purchase: PurchaseFacts | null;
};

type BuyingPayload = {
  venue: string | null;
  suppliers: Array<{ supplierId: string | null; supplierName: string; items: BuyingItem[] }>;
  itemsWithHistory: number;
  itemsTotal: number;
  generatedAt: string;
};

function money(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function when(iso: string | null) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * A price that has moved a long way is worth a look; one that has barely moved
 * is not worth the ink. Below 10% reads as noise on fresh produce.
 */
function movementTone(movement: number | null): 'danger' | 'warning' | 'muted' {
  if (movement === null) return 'muted';
  if (movement >= 0.5) return 'danger';
  if (movement >= 0.15) return 'warning';
  return 'muted';
}

export function BuyingPage() {
  useDocumentTitle('Buying');
  const [payload, setPayload] = useState<BuyingPayload | null>(null);
  const [venue] = useStickyVenue();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [openSuppliers, setOpenSuppliers] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const query = venue ? `?venue=${encodeURIComponent(venue)}` : '';
        const data = await api<BuyingPayload>(`/api/items/by-supplier${query}`);
        if (!cancelled) setPayload(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load buying data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [venue]);

  const needle = search.trim().toLowerCase();
  const groups = useMemo(() => {
    if (!payload) return [];
    if (!needle) return payload.suppliers;
    return payload.suppliers
      .map((group) => ({ ...group, items: group.items.filter((item) => item.name.toLowerCase().includes(needle)) }))
      .filter((group) => group.items.length > 0);
  }, [payload, needle]);

  const movers = useMemo(() => {
    if (!payload) return [];
    return payload.suppliers
      .flatMap((group) => group.items)
      .filter((item) => (item.purchase?.priceMovement ?? 0) >= 0.15)
      .sort((a, b) => (b.purchase!.priceMovement ?? 0) - (a.purchase!.priceMovement ?? 0))
      .slice(0, 8);
  }, [payload]);

  return (
    <div className="page-stack">
      <div className="stats-grid">
        <StatCard
          label="Items we know the source of"
          value={loading ? '-' : String(payload?.itemsWithHistory ?? 0)}
          hint={payload ? `of ${payload.itemsTotal} in the catalogue` : 'From matched invoice lines'}
        />
        <StatCard
          label="Suppliers buying from"
          value={loading ? '-' : String(groups.filter((g) => g.supplierId).length)}
          hint="Derived from invoices, not a price list"
        />
        <StatCard
          label="Prices worth a look"
          value={loading ? '-' : String(movers.length)}
          hint="Up 15% or more on the best price paid"
          tone={movers.length > 0 ? 'warning' : 'positive'}
        />
      </div>

      {error ? <Card><p className="error-text">{error}</p></Card> : null}

      {movers.length > 0 ? (
        <Card title="Prices that have moved" subtitle="Against the cheapest ever paid for the same item, per unit.">
          <div className="stock-buying-movers">
            {movers.map((item) => (
              <div key={item.id} className="stock-buying-mover">
                <span>
                  <strong>{item.name}</strong>
                  <span className="subtle">
                    {money(item.purchase!.lastPriceCents)} now · best {money(item.purchase!.lowPriceCents)} · bought {item.purchase!.purchaseCount}×
                  </span>
                </span>
                <Badge tone={movementTone(item.purchase!.priceMovement)}>
                  +{Math.round((item.purchase!.priceMovement ?? 0) * 100)}%
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card
        title="Where each item comes from"
        subtitle="Supplier and last price paid, worked out from the invoices already entered. No price list to keep up."
        action={
          <Input
            placeholder="Search items…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        }
        padding="none"
      >
        {loading ? <Spinner label="Reading purchase history…" /> : null}
        {!loading && groups.length === 0 ? (
          <EmptyState
            title="Nothing bought yet"
            description="Once supplier invoices are imported and their lines matched to items, this fills in on its own."
          />
        ) : null}

        {groups.map((group) => {
          const key = group.supplierId ?? '__none__';
          const open = openSuppliers[key] ?? group.supplierId !== null;
          return (
            <section key={key} className="stock-buying-group">
              <button
                type="button"
                className="stock-buying-group-head"
                onClick={() => setOpenSuppliers((current) => ({ ...current, [key]: !open }))}
              >
                <strong>{group.supplierName}</strong>
                <span className="subtle">{group.items.length} item{group.items.length === 1 ? '' : 's'}</span>
                {group.supplierId === null ? (
                  <Badge tone="neutral">Nothing bought through the app yet</Badge>
                ) : null}
              </button>
              {open ? (
                <div className="stock-buying-rows">
                  {group.items.slice(0, 200).map((item) => (
                    <div key={item.id} className="stock-buying-row">
                      <span>
                        <strong>{item.name}</strong>
                        <span className="subtle">
                          {item.category?.name ?? 'No category'} · on hand {item.onHand} {item.countUnit ?? item.unit ?? ''}
                          {item.parLevel > 0 ? ` · par ${item.parLevel}` : ' · no par set'}
                        </span>
                      </span>
                      <span className="stock-buying-price">
                        {item.purchase ? (
                          <>
                            <strong>{money(item.purchase.lastPriceCents)}</strong>
                            <span className="subtle">
                              per {item.unit ?? 'unit'} · {when(item.purchase.lastPurchasedAt)} · {item.purchase.purchaseCount}×
                            </span>
                            {item.purchase.supplierShare < 1 ? (
                              <span className="subtle">
                                also bought elsewhere — {Math.round(item.purchase.supplierShare * 100)}% from here
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="subtle">never bought through the app</span>
                        )}
                      </span>
                    </div>
                  ))}
                  {group.items.length > 200 ? (
                    <p className="subtle" style={{ padding: '6px 12px' }}>
                      Showing the first 200 of {group.items.length}. Search to narrow it down.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </Card>
    </div>
  );
}
