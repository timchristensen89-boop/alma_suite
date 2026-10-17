import { useEffect, useMemo, useState } from 'react';
import type { StockCostOfGoodsPayload } from '@alma/shared';
import { Spinner } from '@alma/ui';
import { ApiError, api, suiteApi } from '../../lib/api';
import { Delta, type Scope, changePercent, count, money, percent, scopeLabel, shortDate } from './format';
import { type SalesEntry, type SalesRange, salesWindows, sameDaysLastYear, sum, todaySydney } from './salesWindows';

/**
 * Section one: what the venues are selling, from Square.
 *
 * Two sources, kept apart on purpose:
 *  - Takings: the suite's Square sales import (`SalesActualEntry`, one row
 *    per venue-day, ex GST, as Square reports it). Read once for the last
 *    sixty-odd days and the same window a year earlier, then every period
 *    is summed in the browser — no extra requests when the scope changes.
 *  - The mapped-menu row (the cards the home page carried before the Xero
 *    table arrived): Square items mapped to recipes, their recipe cost and
 *    the ledger's actual cost, from the Stock API's cost-of-goods report.
 *    These are NOT venue takings and say so.
 */

export function SalesSection({ scope, venues }: { scope: Scope; venues: string[] }) {
  const today = useMemo(() => todaySydney(), []);
  const windows = useMemo(() => salesWindows(today), [today]);
  const [entries, setEntries] = useState<SalesEntry[] | null>(null);
  const [salesError, setSalesError] = useState<string | null>(null);

  // One read for everything this year, one for the same span last year.
  useEffect(() => {
    let cancelled = false;
    const earliest = windows.reduce((min, w) => (w.prior.from < min ? w.prior.from : min), windows[0]!.from);
    const ly = sameDaysLastYear(earliest, today);
    void (async () => {
      try {
        const [now, lastYear] = await Promise.all([
          suiteApi<SalesRange>(`/api/reports/sales/range?from=${earliest}&to=${today}`),
          suiteApi<SalesRange>(`/api/reports/sales/range?from=${ly.from}&to=${ly.to}`)
        ]);
        if (!cancelled) {
          setEntries([...now.entries, ...lastYear.entries]);
          setSalesError(null);
        }
      } catch (err) {
        if (!cancelled) setSalesError(err instanceof ApiError ? err.message : 'Could not load Square sales.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [today, windows]);

  // The mapped-menu cards: one cost-of-goods read per scope, kept.
  const [cogsByScope, setCogsByScope] = useState<Record<string, StockCostOfGoodsPayload | 'error'>>({});
  useEffect(() => {
    if (cogsByScope[scope]) return;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({ days: '30' });
        if (scope !== 'group') params.set('venue', scope);
        const payload = await api<StockCostOfGoodsPayload>(`/api/recipes/cost-of-goods?${params.toString()}`);
        if (!cancelled) setCogsByScope((prev) => ({ ...prev, [scope]: payload }));
      } catch {
        if (!cancelled) setCogsByScope((prev) => ({ ...prev, [scope]: 'error' }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, cogsByScope]);
  const cogs = cogsByScope[scope];

  const scopeVenues = scope === 'group' ? venues : [scope];

  return (
    <section className="home-section" aria-labelledby="home-sales-title">
      <header className="home-section-head">
        <div>
          <h2 id="home-sales-title">Sales</h2>
          <p>Square takings for {scopeLabel(scope)}, ex GST, as imported from the till. Each figure sits beside the same days last month and last year.</p>
        </div>
        <span className="home-source">Source: Square</span>
      </header>

      {salesError ? (
        <div className="home-card home-card-empty">
          <strong>Square sales unavailable.</strong> {salesError}
        </div>
      ) : !entries ? (
        <div className="home-card home-card-empty"><Spinner label="Reading Square takings" /></div>
      ) : (
        <div className="home-kpi-row">
          {windows.map((w) => {
            const cur = sum(entries, w.from, w.to, scope);
            const prior = sum(entries, w.prior.from, w.prior.to, scope);
            const ly = sum(entries, w.lastYear.from, w.lastYear.to, scope);
            const perDay = cur.days ? cur.total / cur.days : 0;
            return (
              <article key={w.key} className="home-card home-kpi">
                <h3>{w.label}</h3>
                <p className="home-kpi-value">{cur.total ? money(cur.total) : '—'}</p>
                <p className="home-kpi-sub">
                  {shortDate(w.from)}–{shortDate(w.to)}
                  {cur.days ? ` · ${count(cur.days)} trading day${cur.days === 1 ? '' : 's'} · ${money(perDay)} a day` : ' · no Square sales imported yet'}
                </p>
                <dl className="home-kpi-compare">
                  <div>
                    <dt>vs {w.prior.label}</dt>
                    <dd><Delta value={changePercent(cur.total, prior.total)} good="up" label={`${money(prior.total)} ${shortDate(w.prior.from)}–${shortDate(w.prior.to)}`} /><span>{money(prior.total)}</span></dd>
                  </div>
                  <div>
                    <dt>vs last year</dt>
                    <dd><Delta value={changePercent(cur.total, ly.total)} good="up" label={`${money(ly.total)} ${shortDate(w.lastYear.from)}–${shortDate(w.lastYear.to)}`} /><span>{money(ly.total)}</span></dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      )}

      {/* The cards the home page carried before: the mapped menu's sales,
          what it cost on paper, what the ledger says it cost, and the gap. */}
      <div className="home-mapped">
        <div className="home-mapped-head">
          <h3>Menu items mapped to recipes · last 30 days · {scopeLabel(scope)}</h3>
          <span className="home-source">Square item sales × Stock recipes</span>
        </div>
        {cogs === 'error' ? (
          <p className="subtle">Could not load the mapped-menu figures.</p>
        ) : !cogs ? (
          <Spinner label="Loading mapped item sales" />
        ) : (
          <div className="home-mapped-row">
            <div className="home-mapped-stat">
              <span className="home-mapped-label">Mapped item sales</span>
              <span className="home-mapped-value">{money(cogs.mappedSalesCents)}</span>
              <span className="home-mapped-hint">{cogs.coverage.mappedRecipes} dishes with a recipe · not venue takings{scopeVenues.length > 1 ? ' · all venues' : ''}</span>
            </div>
            <div className="home-mapped-stat">
              <span className="home-mapped-label">Theoretical food &amp; drink cost</span>
              <span className="home-mapped-value">{money(cogs.theoretical.cogsCents)}</span>
              <span className="home-mapped-hint">
                {cogs.theoretical.percentOfMappedSales !== null ? `${percent(cogs.theoretical.percentOfMappedSales)} of mapped sales · ` : ''}recipe cost × units sold
                {cogs.coverage.zeroCostRecipes > 0 ? ` · ${cogs.coverage.zeroCostRecipes} uncosted` : ''}
              </span>
            </div>
            <div className="home-mapped-stat">
              <span className="home-mapped-label">{cogs.actual.source === 'stock_bounded' ? 'Actual food & drink cost' : 'Supplier purchases'}</span>
              <span className="home-mapped-value">{money(cogs.actual.cogsCents)}</span>
              <span className="home-mapped-hint">{cogs.actual.comparable ? `${percent(cogs.actual.percentOfMappedSales)} of mapped sales · ${cogs.actual.label}` : `${cogs.actual.label} — whole-venue figure, not a % of mapped sales`}</span>
            </div>
            <div className="home-mapped-stat">
              <span className="home-mapped-label">Gross profit on mapped sales</span>
              <span className="home-mapped-value">{cogs.mappedSalesCents > 0 ? money(cogs.theoretical.grossProfitCents) : '—'}</span>
              <span className="home-mapped-hint">
                {cogs.mappedSalesCents > 0
                  ? `${percent(cogs.theoretical.grossProfitPercent)} on recipe cost${cogs.actual.comparable && cogs.actual.grossProfitPercent !== null ? ` · ${percent(cogs.actual.grossProfitPercent)} on actual` : ''}`
                  : 'Needs mapped sales in the window'}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
