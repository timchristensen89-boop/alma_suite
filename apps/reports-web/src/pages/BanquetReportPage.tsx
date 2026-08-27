import { useEffect, useMemo, useState } from 'react';
import type { BanquetReportPayload } from '@alma/shared';
import { Badge, Button, Card, Input, Select, Spinner } from '@alma/ui';
import { staffApi } from '../lib/api';

// A set menu sells for one price and its dishes ring at $0, so no dish has a
// price of its own to report on. This page shows what each dish is actually
// worth: the table's package revenue shared across the dishes that table was
// served, weighted by what those dishes fetch a la carte, against the cost of
// cooking them. That is the number that answers "is the banquet making money,
// and which dish is dragging it down".

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

// Food margin below ~65% on a banquet dish is worth a look; below 55% it is
// costing more than the menu assumes.
function marginTone(value: number | null): 'positive' | 'warning' | 'danger' | 'neutral' {
  if (value === null) return 'neutral';
  if (value >= 65) return 'positive';
  if (value >= 55) return 'warning';
  return 'danger';
}

const VENUES = [
  { label: 'All venues', value: 'all' },
  { label: 'St Alma', value: 'St Alma' },
  { label: 'Alma Avalon', value: 'Alma Avalon' }
];

export function BanquetReportPage() {
  const today = useMemo(() => new Date(), []);
  const [start, setStart] = useState(() => isoDate(addDays(today, -28)));
  const [end, setEnd] = useState(() => isoDate(addDays(today, 1)));
  const [venue, setVenue] = useState('all');
  const [payload, setPayload] = useState<BanquetReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ start, end });
    if (venue !== 'all') params.set('venue', venue);
    staffApi<BanquetReportPayload>(`/api/reports/banquets?${params.toString()}`)
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the banquet report.');
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
    const rows: Array<Array<string | number>> = [
      [`Banquets — ${payload.venue ?? 'all venues'}`],
      [`${payload.range.start} to ${payload.range.end}`],
      [],
      ['Dish', 'Served', 'Share of covers', 'A la carte', 'Allocated revenue', 'Supplements', 'Revenue', 'Food cost', 'Margin', 'Margin %', 'Costed'],
      ...payload.dishes.map((dish) => [
        dish.name,
        dish.servings,
        dish.sharePercent === null ? '' : `${dish.sharePercent}%`,
        dish.alaCarteCents === null ? '' : dollars(dish.alaCarteCents),
        dollars(dish.allocatedRevenueCents),
        dollars(dish.supplementRevenueCents),
        dollars(dish.revenueCents),
        dollars(dish.costCents),
        dollars(dish.marginCents),
        dish.marginPercent === null ? '' : `${dish.marginPercent}%`,
        dish.costed ? 'yes' : 'no recipe cost'
      ])
    ];
    const csv = rows.map((row) => row.map(esc).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `banquets-${payload.range.start}-to-${payload.range.end}.csv`;
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
      <Card title="Banquets">
        {controls}
        <div className="forecast-loading">
          <Spinner /> Working out what each dish earned…
        </div>
      </Card>
    );
  }

  if (error || !payload) {
    return (
      <Card title="Banquets">
        {controls}
        <p className="subtle">{error ?? 'Could not load the banquet report.'}</p>
      </Card>
    );
  }

  const { totals, gaps } = payload;

  return (
    <div className="banquet-report">
      <Card title="Banquets">
        {controls}
        {totals.tables === 0 ? (
          <p className="subtle">
            No set menus were rung between {payload.range.start} and {payload.range.end}. Once a banquet goes through the
            register's picker, every dish it served shows up here.
          </p>
        ) : (
          <>
            <div className="banquet-totals">
              <div>
                <span>Banquets</span>
                <strong>{totals.tables}</strong>
                <small>{totals.covers} covers</small>
              </div>
              <div>
                <span>Revenue</span>
                <strong>{money(totals.revenueCents)}</strong>
                <small>
                  {money(totals.packageRevenueCents)} packages
                  {totals.supplementRevenueCents > 0 ? ` · ${money(totals.supplementRevenueCents)} upgrades` : ''}
                </small>
              </div>
              <div>
                <span>Food cost</span>
                <strong>{money(totals.costCents)}</strong>
                <small>{money(totals.costPerCoverCents)} a cover</small>
              </div>
              <div>
                <span>Margin</span>
                <strong>{money(totals.marginCents)}</strong>
                <small>
                  {percent(totals.marginPercent)} · {money(totals.revenuePerCoverCents)} a cover
                </small>
              </div>
            </div>
            {/* Say plainly which numbers are soft. A dish with no recipe cost
                reads as pure margin, which is the one way this report can
                flatter itself. */}
            {gaps.uncostedDishes.length > 0 || gaps.unpricedDishes.length > 0 ? (
              <div className="banquet-gaps">
                {gaps.uncostedDishes.length > 0 ? (
                  <p>
                    <Badge tone="warning">Margin reads high</Badge> No recipe cost on{' '}
                    {gaps.uncostedDishes.join(', ')} — cost them in Stock and these figures tighten up.
                  </p>
                ) : null}
                {gaps.unpricedDishes.length > 0 ? (
                  <p>
                    <Badge tone="warning">Split evenly</Badge> No à la carte price on{' '}
                    {gaps.unpricedDishes.join(', ')}, so revenue was shared per serving instead of by value.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </Card>

      {payload.menus.length > 0 ? (
        <Card title="By menu">
          <table className="banquet-table">
            <thead>
              <tr>
                <th>Set menu</th>
                <th className="num">Tables</th>
                <th className="num">Covers</th>
                <th className="num">Revenue</th>
                <th className="num">Food cost</th>
                <th className="num">Cost a cover</th>
                <th className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {payload.menus.map((menu) => (
                <tr key={menu.recipeId ?? menu.name}>
                  <td>{menu.name}</td>
                  <td className="num">{menu.tables}</td>
                  <td className="num">{menu.covers}</td>
                  <td className="num">{money(menu.revenueCents)}</td>
                  <td className="num">{money(menu.costCents)}</td>
                  <td className="num">{money(menu.costPerCoverCents)}</td>
                  <td className="num">
                    {money(menu.marginCents)}{' '}
                    <Badge tone={marginTone(menu.marginPercent)}>{percent(menu.marginPercent)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {payload.dishes.length > 0 ? (
        <Card
          title="By dish"
          subtitle="Package revenue shared across the dishes each table was served, weighted by à la carte value."
        >
          <table className="banquet-table">
            <thead>
              <tr>
                <th>Dish</th>
                <th className="num">Served</th>
                <th className="num">Share</th>
                <th className="num">À la carte</th>
                <th className="num">Revenue</th>
                <th className="num">Food cost</th>
                <th className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {payload.dishes.map((dish) => (
                <tr key={dish.recipeId ?? dish.name} className={dish.costed ? undefined : 'is-uncosted'}>
                  <td>
                    {dish.name}
                    {dish.menus.length > 0 ? <small className="banquet-dish-menus">{dish.menus.join(' · ')}</small> : null}
                  </td>
                  <td className="num">{dish.servings}</td>
                  <td className="num">{percent(dish.sharePercent)}</td>
                  <td className="num">{money(dish.alaCarteCents)}</td>
                  <td className="num">
                    {money(dish.revenueCents)}
                    {dish.supplementRevenueCents > 0 ? (
                      <small className="banquet-dish-menus">incl. {money(dish.supplementRevenueCents)} upgrades</small>
                    ) : null}
                  </td>
                  <td className="num">{dish.costed ? money(dish.costCents) : <Badge tone="warning">not costed</Badge>}</td>
                  <td className="num">
                    {money(dish.marginCents)}{' '}
                    {dish.costed ? <Badge tone={marginTone(dish.marginPercent)}>{percent(dish.marginPercent)}</Badge> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {payload.nights.length > 0 ? (
        <Card title="By night">
          <table className="banquet-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Tables</th>
                <th className="num">Covers</th>
                <th className="num">Revenue</th>
                <th className="num">Food cost</th>
                <th className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {payload.nights.map((night) => (
                <tr key={night.date}>
                  <td>{new Date(`${night.date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                  <td className="num">{night.tables}</td>
                  <td className="num">{night.covers}</td>
                  <td className="num">{money(night.revenueCents)}</td>
                  <td className="num">{money(night.costCents)}</td>
                  <td className="num">{money(night.marginCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
