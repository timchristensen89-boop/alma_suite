import { useEffect, useMemo, useState } from 'react';
import type { WineAgingRow, WineBucketRow, WineReportPayload } from '@alma/shared';
import { Badge, Button, Card, Input, Select, Spinner } from '@alma/ui';
import { staffApi } from '../lib/api';

// What the wine list is actually doing. Six cuts of the same sales — grape,
// region, origin, price band, pour size — plus what has gone quiet.
//
// Two things this page is careful about, because both are ways a wine report
// can lie to you:
//
//  · Margin is over the revenue that HAS a cost behind it. A wine with no cost
//    recorded is not 100% margin, it is unknown, and the page says so rather
//    than letting it top the table.
//  · Sales come from two registers. Wine only started ringing through the
//    suite's own POS on 2026-08-20; everything before that is in the imported
//    Square and Lightspeed rows. The split is shown so a window that spans the
//    changeover is not mistaken for a collapse in trade.

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function money(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function percent(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

// Wine runs a far higher margin than food: a bottle at 70% is ordinary, and
// anything under 60% is either a mispriced list or a cost that has moved.
function marginTone(value: number | null): 'positive' | 'warning' | 'danger' | 'neutral' {
  if (value === null) return 'neutral';
  if (value >= 70) return 'positive';
  if (value >= 60) return 'warning';
  return 'danger';
}

const VENUES = [
  { label: 'All venues', value: 'all' },
  { label: 'St Alma', value: 'St Alma' },
  { label: 'Alma Avalon', value: 'Alma Avalon' }
];

function BucketTable({ rows, unit }: { rows: WineBucketRow[]; unit: string }) {
  if (rows.length === 0) return <p className="subtle">Nothing on the list carries a {unit}.</p>;
  return (
    <table className="banquet-table">
      <thead>
        <tr>
          <th>{unit}</th>
          <th className="num">On list</th>
          <th className="num">Bottles</th>
          <th className="num">Glasses</th>
          <th className="num">Revenue</th>
          <th className="num">Share</th>
          <th className="num">Margin<small> ex GST</small></th>
          <th className="num">Margin %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className={row.marginPercent === null ? 'is-uncosted' : undefined}>
            <td>{row.label}</td>
            <td className="num">{row.wines}</td>
            <td className="num">{row.bottles}</td>
            <td className="num">{row.glasses}</td>
            <td className="num">{money(row.revenueCents)}</td>
            <td className="num">{percent(row.sharePercent)}</td>
            <td className="num">{row.marginPercent === null ? '—' : money(row.marginCents)}</td>
            <td className="num">
              {row.marginPercent === null ? (
                <span className="subtle">no cost</span>
              ) : (
                <Badge tone={marginTone(row.marginPercent)}>{percent(row.marginPercent)}</Badge>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AgingTable({ rows }: { rows: WineAgingRow[] }) {
  return (
    <table className="banquet-table">
      <thead>
        <tr>
          <th>Wine</th>
          <th>Venue</th>
          <th className="num">Vintage</th>
          <th className="num">Bottle</th>
          <th className="num">Last sold</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.wineId}>
            <td>
              {row.name}
              {row.limitedStock ? <span className="wine-aging-note">limited stock</span> : null}
            </td>
            <td>{row.venue}</td>
            <td className="num">
              {row.vintage ?? 'NV'}
              {row.vintageAge !== null ? <span className="wine-aging-note">{row.vintageAge} yr</span> : null}
            </td>
            <td className="num">{money(row.bottlePriceCents)}</td>
            <td className="num">
              {row.daysSinceSold === null ? (
                <Badge tone="danger">never</Badge>
              ) : (
                <>
                  {row.daysSinceSold} days
                  <span className="wine-aging-note">{row.lastSoldAt}</span>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WineReportPage() {
  const today = useMemo(() => new Date(), []);
  const [start, setStart] = useState(() => isoDate(addDays(today, -90)));
  const [end, setEnd] = useState(() => isoDate(addDays(today, 1)));
  const [venue, setVenue] = useState('all');
  const [payload, setPayload] = useState<WineReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ start, end });
    if (venue !== 'all') params.set('venue', venue);
    staffApi<WineReportPayload>(`/api/reports/wines?${params.toString()}`)
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the wine report.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [start, end, venue]);

  function exportCsv() {
    if (!payload) return;
    const esc = (value: string | number) => {
      const text = String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const dollars = (cents: number) => (cents / 100).toFixed(2);
    const bucket = (title: string, rows: WineBucketRow[]): Array<Array<string | number>> => [
      [],
      [title],
      // Revenue is what the till took (GST inclusive); margin is ex-GST on
      // both sides. Spelled out in the header so a spreadsheet away from this
      // page cannot be read the wrong way.
      ['', 'On list', 'Bottles', 'Glasses', 'Quantity', 'Revenue (inc GST)', 'Share %', 'Costed revenue (inc GST)', 'Cost (ex GST)', 'Margin (ex GST)', 'Margin %'],
      ...rows.map((row) => [
        row.label,
        row.wines,
        row.bottles,
        row.glasses,
        row.quantity,
        dollars(row.revenueCents),
        row.sharePercent === null ? '' : row.sharePercent.toFixed(1),
        dollars(row.costedRevenueCents),
        dollars(row.costCents),
        row.marginPercent === null ? '' : dollars(row.marginCents),
        row.marginPercent === null ? '' : row.marginPercent.toFixed(1)
      ])
    ];
    const rows: Array<Array<string | number>> = [
      [`Wine — ${payload.venue ?? 'all venues'}`],
      [`${payload.range.start} to ${payload.range.end}`],
      [],
      ['Wines on list', payload.totals.winesOnList],
      ['Pours sellable', payload.totals.poursSellable],
      ['Bottles sold', payload.totals.bottles],
      ['Glasses sold', payload.totals.glasses],
      ['Revenue', dollars(payload.totals.revenueCents)],
      ['Revenue with a cost behind it', dollars(payload.totals.costedRevenueCents)],
      ['Revenue with no cost recorded', dollars(payload.totals.uncostedRevenueCents)],
      ['Margin (ex GST)', dollars(payload.totals.marginCents)],
      ['Margin %', payload.totals.marginPercent === null ? '' : payload.totals.marginPercent.toFixed(1)],
      ...bucket('By grape', payload.byGrape),
      ...bucket('By region', payload.byRegion),
      ...bucket('By origin', payload.byOrigin),
      ...bucket('By price band (bottle price)', payload.byBand),
      ...bucket('By pour size', payload.byPourSize),
      [],
      ['Not selling'],
      ['Wine', 'Venue', 'Vintage', 'Vintage age', 'Bottle', 'Last sold', 'Days since'],
      ...payload.aging.map((row) => [
        row.name,
        row.venue,
        row.vintage ?? 'NV',
        row.vintageAge ?? '',
        row.bottlePriceCents === null ? '' : dollars(row.bottlePriceCents),
        row.lastSoldAt ?? 'never',
        row.daysSinceSold ?? ''
      ])
    ];
    const csv = rows.map((row) => row.map(esc).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = `alma-wine-${payload.range.start}-to-${payload.range.end}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const controls = (
    <div className="banquet-controls">
      <Input label="From" type="date" value={start} onChange={(event) => setStart(event.currentTarget.value)} />
      <Input label="To" type="date" value={end} onChange={(event) => setEnd(event.currentTarget.value)} />
      <Select label="Venue" value={venue} options={VENUES} onChange={(event) => setVenue(event.currentTarget.value)} />
      <Button type="button" variant="secondary" disabled={!payload} onClick={exportCsv}>
        Export CSV
      </Button>
    </div>
  );

  if (loading) {
    return (
      <Card title="Wine">
        {controls}
        <div className="forecast-loading">
          <Spinner /> Reading the list against what sold…
        </div>
      </Card>
    );
  }

  if (error || !payload) {
    return (
      <Card title="Wine">
        {controls}
        <p className="subtle">{error ?? 'Could not load the wine report.'}</p>
      </Card>
    );
  }

  const { totals, gaps } = payload;
  const sold = totals.quantity > 0;

  return (
    <div className="banquet-report">
      <Card title="Wine">
        {controls}
        <div className="banquet-totals">
          <div>
            <span>On the list</span>
            <strong>{totals.winesOnList}</strong>
            <small>{totals.poursSellable} pours the register can ring</small>
          </div>
          <div>
            <span>Sold</span>
            <strong>{totals.quantity}</strong>
            <small>
              {totals.bottles} bottles · {totals.glasses} glasses
            </small>
          </div>
          <div>
            <span>Revenue</span>
            <strong>{money(totals.revenueCents)}</strong>
            <small>
              {totals.importedRevenueCents > 0 && totals.registerRevenueCents > 0
                ? `${money(totals.registerRevenueCents)} register · ${money(totals.importedRevenueCents)} imported`
                : totals.importedRevenueCents > 0
                  ? 'from the imported tills'
                  : 'from the register'}
            </small>
          </div>
          <div>
            <span>Margin</span>
            <strong>{totals.marginPercent === null ? '—' : money(totals.marginCents)}</strong>
            <small>
              {totals.marginPercent === null
                ? 'no cost recorded on anything that sold'
                : `${percent(totals.marginPercent)} on ${money(totals.costedRevenueCents)} of costed sales — ex GST both sides`}
            </small>
          </div>
        </div>

        {/* The one way this report can flatter itself: an uncosted wine reads
            as pure profit. Say how much of the revenue that is. */}
        {totals.uncostedRevenueCents > 0 || gaps.uncostedWines.length > 0 || gaps.unpricedWines.length > 0 ? (
          <div className="banquet-gaps">
            {totals.uncostedRevenueCents > 0 ? (
              <p>
                <Badge tone="warning">Margin is partial</Badge>
                {money(totals.uncostedRevenueCents)} of the {money(totals.revenueCents)} sold has no cost behind it, so it
                is left out of every margin figure on this page rather than counted as profit.
              </p>
            ) : null}
            {gaps.uncostedWines.length > 0 ? (
              <p>
                <Badge tone="warning">No cost</Badge>
                {gaps.uncostedWines.length} wine{gaps.uncostedWines.length === 1 ? ' on the list has' : 's on the list have'} no
                cost on any pour — {gaps.uncostedWines.slice(0, 6).join(', ')}
                {gaps.uncostedWines.length > 6 ? ` and ${gaps.uncostedWines.length - 6} more` : ''}. Cost them in Stock
                and the margins above fill in.
              </p>
            ) : null}
            {gaps.unpricedWines.length > 0 ? (
              <p>
                <Badge tone="danger">No price</Badge>
                {gaps.unpricedWines.length} wine{gaps.unpricedWines.length === 1 ? '' : 's'} cannot be banded because no
                pour carries a price — {gaps.unpricedWines.slice(0, 6).join(', ')}
                {gaps.unpricedWines.length > 6 ? ` and ${gaps.unpricedWines.length - 6} more` : ''}.
              </p>
            ) : null}
          </div>
        ) : null}

        {!sold ? (
          <p className="subtle" style={{ marginTop: 16 }}>
            No wine sold between {payload.range.start} and {payload.range.end}. The counts above still describe the list
            itself, and every wine appears under “Not selling” below. Wine only started ringing through this register on
            20 August 2026 — widen the window to pick up the imported till history.
          </p>
        ) : null}
      </Card>

      <Card title="By grape">
        <BucketTable rows={payload.byGrape} unit="grape" />
      </Card>

      <Card title="By region">
        <BucketTable rows={payload.byRegion} unit="region" />
      </Card>

      <Card title="By origin">
        <BucketTable rows={payload.byOrigin} unit="origin" />
      </Card>

      <Card title="By price band">
        <p className="subtle">
          Banded on the bottle price, the same cuts the register filters by. A wine sold only by the glass bands on its
          largest pour.
        </p>
        <BucketTable rows={payload.byBand} unit="band" />
      </Card>

      <Card title="By pour size">
        <p className="subtle">
          Whether pouring by the glass pays for the bottle you open to do it. “On list” counts the wines offered in that
          size, sold or not.
        </p>
        <BucketTable rows={payload.byPourSize} unit="pour" />
      </Card>

      <Card title={`Not selling (${payload.aging.length})`}>
        {payload.aging.length === 0 ? (
          <p className="subtle">Every wine on the list sold at least once in this window.</p>
        ) : (
          <>
            <p className="subtle">
              Nothing here sold between {payload.range.start} and {payload.range.end}. Never-sold first, then the longest
              quiet — and inside each, the dearest bottle first, because that is where the money is sitting.
            </p>
            <AgingTable rows={payload.aging} />
          </>
        )}
      </Card>
    </div>
  );
}
