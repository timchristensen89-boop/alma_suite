import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Recipe, RecipesPayload } from '@alma/shared';
import { COMPACT_ROWS, LISTS, PAGE, PERIODS, type ListKind, type Period, type ProductRow, type SortKey, merge, sortRows, toRow } from './productMath';
import { Spinner } from '@alma/ui';
import { ApiError, api } from '../../lib/api';
import { ScopeSwitch, type Scope, count, money, percent, scopeLabel } from './format';

/**
 * Section three: what sold, what earned and what did not move.
 *
 * Rows come from the recipe list with its Square sales join, one request per
 * venue and period, cached for the page's life. The group view adds the
 * venues' rows together by dish. Three ranked lists open into one table with
 * search, sort, a category filter and paging — the whole dataset is already
 * in the browser (a few hundred dishes), so no further requests.
 */

function FigureCell({ r, kind }: { r: ProductRow; kind: ListKind }) {
  if (kind === 'earners') return <>{money(r.profitCents)}<span className="home-product-sub">{r.marginPercent !== null ? ` · ${percent(r.marginPercent, 0)}` : ''}</span></>;
  return <>{count(r.units)}<span className="home-product-sub"> · {money(r.netSalesCents)}</span></>;
}

function CompactList({ kind, rows, onViewAll }: { kind: ListKind; rows: ProductRow[]; onViewAll: () => void }) {
  const def = LISTS[kind];
  return (
    <div className="home-product-list">
      <h3>{def.title}<span>{def.hint}</span></h3>
      {rows.length === 0 ? <p className="subtle">Nothing to rank in this window.</p> : (
        <ol>
          {rows.slice(0, COMPACT_ROWS).map((r, i) => (
            <li key={r.key}>
              <span className="home-product-rank">{i + 1}</span>
              <span className="home-product-name" title={r.title}>{r.title}</span>
              <span className="home-product-figure"><FigureCell r={r} kind={kind} /></span>
            </li>
          ))}
        </ol>
      )}
      {rows.length > 0 ? (
        <button type="button" className="btn btn-sm btn-ghost home-viewall" onClick={onViewAll}>
          View all {count(rows.length)}
        </button>
      ) : null}
    </div>
  );
}

/** The full table's filters live in the section, so switching venue or period (which re-fetches) keeps them. */
export type TableFilters = { search: string; category: string; sort: { key: SortKey; desc: boolean }; shown: number };
export const defaultFilters = (kind: ListKind): TableFilters => ({ search: '', category: '', sort: { key: LISTS[kind].sortKey, desc: LISTS[kind].desc }, shown: PAGE });

function FullTable({ kind, rows, categories, filters, onFilters, onClose }: { kind: ListKind; rows: ProductRow[]; categories: string[]; filters: TableFilters; onFilters: (f: TableFilters) => void; onClose: () => void }) {
  const def = LISTS[kind];
  const { search, category, sort, shown } = filters;
  const setSearch = (search: string) => onFilters({ ...filters, search, shown: PAGE });
  const setCategory = (category: string) => onFilters({ ...filters, category, shown: PAGE });
  const setSort = (next: (s: { key: SortKey; desc: boolean }) => { key: SortKey; desc: boolean }) => onFilters({ ...filters, sort: next(filters.sort) });
  const setShown = (next: (n: number) => number) => onFilters({ ...filters, shown: next(filters.shown) });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortRows(rows.filter((r) => (!q || r.title.toLowerCase().includes(q)) && (!category || r.category === category)), sort.key, sort.desc);
  }, [rows, search, category, sort]);
  const visible = filtered.slice(0, shown);

  const header = (label: string, key: SortKey, align: 'left' | 'right' = 'right') => (
    <th className={align === 'right' ? 'is-num' : ''} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className={`home-sort${sort.key === key ? ' is-active' : ''}`} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }))}>
        {label}{sort.key === key ? <span aria-hidden>{sort.desc ? ' ▾' : ' ▴'}</span> : null}
      </button>
    </th>
  );

  return (
    <div className="home-product-full">
      <div className="home-product-toolbar">
        <h3>{def.title}<span>{def.hint} · {count(filtered.length)} of {count(rows.length)}</span></h3>
        <div className="home-product-filters">
          <input type="search" className="input" placeholder="Search dishes" aria-label="Search dishes" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          {categories.length > 1 ? (
            <select className="input" aria-label="Category" value={category} onChange={(e) => setCategory(e.currentTarget.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : null}
          <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
      <div className="stock-dashboard-table-scroll">
        <table className="home-product-table">
          <thead>
            <tr>
              <th className="is-rank">#</th>
              {header('Dish', 'name', 'left')}
              <th>Category</th>
              {header('Units', 'units')}
              {header('Net sales', 'sales')}
              {header('Gross profit', 'profit')}
              {header('Margin', 'margin')}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={7} className="subtle">No dishes match.</td></tr>
            ) : visible.map((r, i) => (
              <tr key={r.key}>
                <td className="is-rank">{i + 1}</td>
                <td><span className="home-product-name" title={r.title}>{r.title}</span>{r.venues.length > 1 ? <span className="home-product-sub"> · both venues</span> : null}</td>
                <td className="subtle">{r.category ?? '—'}</td>
                <td className="is-num">{count(r.units)}</td>
                <td className="is-num">{money(r.netSalesCents)}</td>
                <td className="is-num">{r.costed ? money(r.profitCents) : <span className="subtle" title="Recipe not costed yet">uncosted</span>}</td>
                <td className="is-num">{r.costed ? percent(r.marginPercent, 0) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > shown ? (
        <button type="button" className="btn btn-sm btn-ghost home-viewall" onClick={() => setShown((n) => n + PAGE)}>
          Show {count(Math.min(PAGE, filtered.length - shown))} more · {count(filtered.length - shown)} left
        </button>
      ) : null}
    </div>
  );
}

export function ProductsSection({ scope, venues, onScope }: { scope: Scope; venues: string[]; onScope: (s: Scope) => void }) {
  const [period, setPeriod] = useState<Period>(30);
  const [includeUnsold, setIncludeUnsold] = useState(false);
  const [cache, setCache] = useState<Record<string, Recipe[] | 'error'>>({});
  const [expanded, setExpanded] = useState<ListKind | null>(null);
  const [filters, setFilters] = useState<Record<ListKind, TableFilters>>({ top: defaultFilters('top'), earners: defaultFilters('earners'), slow: defaultFilters('slow') });
  const wanted = scope === 'group' ? venues : [scope];
  // Requests already on their way, so a venue is never fetched twice while
  // its first read is still pending (the cache only fills once it lands).
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    const missing = wanted.filter((v) => !cache[`${v}|${period}`] && !inFlight.current.has(`${v}|${period}`));
    if (missing.length === 0) return;
    for (const venue of missing) {
      const key = `${venue}|${period}`;
      inFlight.current.add(key);
      void (async () => {
        try {
          const payload = await api<RecipesPayload>(`/api/recipes?withSales=${period}&venue=${encodeURIComponent(venue)}`);
          setCache((c) => ({ ...c, [key]: payload.recipes }));
        } catch (err) {
          setCache((c) => ({ ...c, [key]: 'error' }));
          if (err instanceof ApiError) console.warn(err.message);
        } finally {
          inFlight.current.delete(key);
        }
      })();
    }
  }, [wanted.join('|'), period, cache]);

  const loaded = wanted.every((v) => cache[`${v}|${period}`] && cache[`${v}|${period}`] !== 'error');
  const failed = wanted.some((v) => cache[`${v}|${period}`] === 'error');

  const rows = useMemo(() => {
    if (!loaded) return [];
    const all = wanted.flatMap((venue) => {
      const recipes = cache[`${venue}|${period}`] as Recipe[];
      // Dishes only (not prep batches), active, and known to the till: a
      // missing actualSales means "not mapped to Square", not "sold none".
      return recipes.filter((r) => !r.isPrepRecipe && r.status === 'ACTIVE' && r.actualSales).map((r) => toRow(r, venue));
    });
    return scope === 'group' ? merge(all) : all;
  }, [loaded, cache, wanted.join('|'), period, scope]);

  const sold = rows.filter((r) => r.units > 0);
  const lists: Record<ListKind, ProductRow[]> = {
    top: sortRows(sold, 'units', true),
    earners: sortRows(sold.filter((r) => r.costed), 'profit', true),
    slow: sortRows(includeUnsold ? rows : sold, 'units', false)
  };
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category).filter((c): c is string => Boolean(c)))].sort(), [rows]);
  const uncosted = sold.filter((r) => !r.costed).length;
  const unsold = rows.length - sold.length;

  return (
    <section className="home-section" aria-labelledby="home-products-title">
      <header className="home-section-head">
        <div>
          <h2 id="home-products-title">Product performance</h2>
          <p>Dishes at {scopeLabel(scope)} over the last {period} days of till sales{loaded ? ` · ${count(sold.length)} sold${unsold > 0 ? ` · ${count(unsold)} on the till with no sales` : ''}` : ''}.</p>
        </div>
        <div className="home-section-actions">
          <ScopeSwitch scope={scope} venues={venues} onChange={onScope} size="sm" />
          <div className="home-scope home-scope-sm" role="tablist" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p} type="button" role="tab" aria-selected={period === p} className={period === p ? 'is-active' : ''} onClick={() => setPeriod(p)}>{p}d</button>
            ))}
          </div>
          <span className="home-source">Source: Square item sales</span>
        </div>
      </header>
      <div className="home-card">
        {failed ? (
          <div className="home-card-empty"><strong>Dish sales unavailable.</strong> The Stock API did not return the recipe sales for {scopeLabel(scope)}.</div>
        ) : !loaded ? (
          <div className="home-card-empty"><Spinner label={`Loading dish sales for ${scopeLabel(scope)}`} /></div>
        ) : expanded ? (
          <FullTable kind={expanded} rows={lists[expanded]} categories={categories} filters={filters[expanded]} onFilters={(f) => setFilters((all) => ({ ...all, [expanded]: f }))} onClose={() => setExpanded(null)} />
        ) : (
          <div className="home-product-grid">
            {(Object.keys(LISTS) as ListKind[]).map((kind) => (
              <CompactList key={kind} kind={kind} rows={lists[kind]} onViewAll={() => setExpanded(kind)} />
            ))}
          </div>
        )}
        {loaded ? (
          <div className="home-product-foot">
            <label className="home-check">
              <input type="checkbox" checked={includeUnsold} onChange={(e) => setIncludeUnsold(e.currentTarget.checked)} />
              Include dishes with no sales in the window in Slowest sellers
            </label>
            {uncosted > 0 ? <span className="subtle">{count(uncosted)} dish{uncosted === 1 ? '' : 'es'} sold without a usable recipe cost and so sit outside Top earners. <Link to="/recipes">Cost recipes →</Link></span> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
