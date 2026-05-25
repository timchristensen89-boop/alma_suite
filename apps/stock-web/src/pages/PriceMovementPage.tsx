import { useEffect, useMemo, useState } from 'react';
import type { StockInvoicesPayload, StockSupplierInvoiceLine } from '@alma/shared';
import { Badge, Card, EmptyState, Input, Select, Spinner } from '@alma/ui';
import { api } from '../lib/api';

type WindowDays = 30 | 60 | 90;
type ToneFilter = 'all' | 'up' | 'down';

type ItemPriceMovement = {
  itemId: string;
  itemName: string;
  unit: string | null;
  supplierName: string;
  earliestDate: string;
  latestDate: string;
  earliestUnitCents: number;
  latestUnitCents: number;
  deltaCents: number;
  deltaPercent: number;
  lineCount: number;
};

function formatMoney(cents: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2
  }).format(cents / 100);
}

export function PriceMovementPage() {
  const [payload, setPayload] = useState<StockInvoicesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [threshold, setThreshold] = useState(5);
  const [search, setSearch] = useState('');
  const [toneFilter, setToneFilter] = useState<ToneFilter>('all');

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        setPayload(await api<StockInvoicesPayload>('/api/invoices'));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load invoices');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const movements = useMemo<ItemPriceMovement[]>(() => {
    if (!payload) return [];
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;

    // Flatten lines, only matched-to-item lines with valid unit price + date
    type LineWithMeta = {
      itemId: string;
      itemName: string;
      unit: string | null;
      supplierName: string;
      invoiceDate: Date;
      unitCents: number;
    };
    const lines: LineWithMeta[] = [];
    for (const invoice of payload.invoices) {
      if (!invoice.invoiceDate) continue;
      const d = new Date(invoice.invoiceDate);
      if (d.getTime() < cutoff) continue;
      for (const line of (invoice.lines ?? []) as StockSupplierInvoiceLine[]) {
        if (!line.item || !line.itemId) continue;
        if (!Number.isFinite(line.unitAmountCents) || line.unitAmountCents <= 0) continue;
        lines.push({
          itemId: line.itemId,
          itemName: line.item.name,
          unit: line.unit ?? line.item.unit,
          supplierName: invoice.supplierName,
          invoiceDate: d,
          unitCents: line.unitAmountCents
        });
      }
    }

    // Group by itemId
    const grouped = new Map<string, LineWithMeta[]>();
    for (const line of lines) {
      const arr = grouped.get(line.itemId) ?? [];
      arr.push(line);
      grouped.set(line.itemId, arr);
    }

    const out: ItemPriceMovement[] = [];
    for (const [itemId, group] of grouped) {
      if (group.length < 2) continue;
      group.sort((a, b) => a.invoiceDate.getTime() - b.invoiceDate.getTime());
      const earliest = group[0]!;
      const latest = group[group.length - 1]!;
      if (earliest.unitCents === latest.unitCents) continue;
      const deltaCents = latest.unitCents - earliest.unitCents;
      const deltaPercent = (deltaCents / earliest.unitCents) * 100;
      out.push({
        itemId,
        itemName: latest.itemName,
        unit: latest.unit,
        supplierName: latest.supplierName,
        earliestDate: earliest.invoiceDate.toISOString(),
        latestDate: latest.invoiceDate.toISOString(),
        earliestUnitCents: earliest.unitCents,
        latestUnitCents: latest.unitCents,
        deltaCents,
        deltaPercent,
        lineCount: group.length
      });
    }
    return out.sort((a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent));
  }, [payload, windowDays]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return movements
      .filter((m) => Math.abs(m.deltaPercent) >= threshold)
      .filter((m) => toneFilter === 'all' || (toneFilter === 'up' ? m.deltaPercent > 0 : m.deltaPercent < 0))
      .filter((m) => !term || m.itemName.toLowerCase().includes(term) || m.supplierName.toLowerCase().includes(term));
  }, [movements, threshold, toneFilter, search]);

  const summary = useMemo(() => {
    const movers = movements.filter((m) => Math.abs(m.deltaPercent) >= threshold);
    const up = movers.filter((m) => m.deltaPercent > 0).length;
    const down = movers.filter((m) => m.deltaPercent < 0).length;
    return { movers: movers.length, up, down };
  }, [movements, threshold]);

  if (loading) {
    return <Card title="Supplier price movement"><Spinner label="Loading invoices…" /></Card>;
  }
  if (error) {
    return <Card title="Supplier price movement"><p className="error-text">{error}</p></Card>;
  }

  return (
    <Card
      title="Supplier price movement"
      subtitle={`Items where the unit cost has moved ≥${threshold}% in the last ${windowDays} days — direct input into repricing decisions.`}
    >
      <div className="price-movement-summary">
        <div className="price-movement-tile is-warning">
          <strong>{summary.movers}</strong>
          <span>Items moved ≥{threshold}%</span>
        </div>
        <div className="price-movement-tile is-danger">
          <strong>{summary.up}</strong>
          <span>Up ▲ (cost increase)</span>
        </div>
        <div className="price-movement-tile is-positive">
          <strong>{summary.down}</strong>
          <span>Down ▼ (cost decrease)</span>
        </div>
      </div>

      <div className="price-movement-filters">
        <Input
          label="Search"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder="Item or supplier name"
        />
        <Select
          label="Window"
          value={String(windowDays)}
          onChange={(event) => setWindowDays(Number(event.currentTarget.value) as WindowDays)}
          options={[
            { label: 'Last 30 days', value: '30' },
            { label: 'Last 60 days', value: '60' },
            { label: 'Last 90 days', value: '90' }
          ]}
        />
        <Input
          label="Threshold %"
          type="number"
          min="0"
          max="100"
          value={String(threshold)}
          onChange={(event) => setThreshold(Number(event.currentTarget.value) || 0)}
        />
        <Select
          label="Direction"
          value={toneFilter}
          onChange={(event) => setToneFilter(event.currentTarget.value as ToneFilter)}
          options={[
            { label: 'All', value: 'all' },
            { label: 'Increases only', value: 'up' },
            { label: 'Decreases only', value: 'down' }
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No movement above threshold"
          description="Lower the threshold or widen the window to surface smaller changes. Or this is good news — costs are stable."
        />
      ) : (
        <div className="price-movement-table">
          <div className="price-movement-row price-movement-head">
            <span>Item</span>
            <span>Supplier</span>
            <span>Earliest</span>
            <span>Latest</span>
            <span>Change</span>
            <span>Movement</span>
          </div>
          {filtered.map((m) => {
            const isUp = m.deltaPercent > 0;
            return (
              <div key={m.itemId} className={`price-movement-row is-${isUp ? 'up' : 'down'}`}>
                <span className="price-movement-name">
                  <strong>{m.itemName}</strong>
                  <small>{m.lineCount} invoice line{m.lineCount === 1 ? '' : 's'} in window</small>
                </span>
                <span>{m.supplierName}</span>
                <span>
                  {formatMoney(m.earliestUnitCents)}{m.unit ? `/${m.unit}` : ''}
                  <small> · {new Date(m.earliestDate).toLocaleDateString()}</small>
                </span>
                <span>
                  {formatMoney(m.latestUnitCents)}{m.unit ? `/${m.unit}` : ''}
                  <small> · {new Date(m.latestDate).toLocaleDateString()}</small>
                </span>
                <span>
                  {isUp ? '+' : ''}{formatMoney(m.deltaCents)}
                </span>
                <span>
                  <Badge tone={isUp ? 'danger' : 'positive'}>
                    {isUp ? '▲' : '▼'} {Math.abs(m.deltaPercent).toFixed(1)}%
                  </Badge>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
