import { Fragment, useState } from 'react';
import type { StockCogsComparison, StockCogsFigure, StockCogsOverviewPayload, StockCogsRow } from '@alma/shared';
import { Spinner } from '@alma/ui';
import { Delta, money, monthName, percent, shortDate } from './format';

/**
 * Section two: cost of goods from the Xero profit and loss, one row per
 * venue plus the group, four periods, each beside its prior period.
 *
 * Collapsed, a row shows the headline: cost of goods and its share of sales.
 * Expanded, the same four periods open into revenue, cost of goods, COGS %,
 * gross profit and gross margin — each with the prior figure and the change
 * — and what the cost of goods is made of (Xero's food, beverage and other
 * Direct Costs accounts). Everything shown is in the payload; nothing is
 * derived beyond sales − cost of goods.
 */

type PeriodKey = 'previousMonth' | 'monthToDate' | 'lastMonth' | 'yearToDate';
const PERIODS: PeriodKey[] = ['previousMonth', 'monthToDate', 'lastMonth', 'yearToDate'];

function heading(key: PeriodKey, row: StockCogsRow) {
  const c = row[key];
  switch (key) {
    case 'previousMonth': return { title: 'This month so far', sub: `vs ${shortDate(c.priorFrom)}–${shortDate(c.priorTo)}` };
    case 'monthToDate': return { title: 'This month so far', sub: 'vs the same days last year' };
    case 'lastMonth': return { title: monthName(c.from), sub: `vs ${monthName(c.priorFrom)}` };
    case 'yearToDate': return { title: 'Year to date', sub: `1 Jan–${shortDate(c.to)} vs last year` };
  }
}

function gp(f: StockCogsFigure) {
  return f.salesCents - f.cogsCents;
}
function gm(f: StockCogsFigure) {
  return f.salesCents > 0 ? Math.round((gp(f) / f.salesCents) * 1000) / 10 : null;
}
function pp(a: number | null, b: number | null) {
  return a === null || b === null ? null : Math.round((a - b) * 10) / 10;
}
function rel(a: number, b: number) {
  return b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null;
}

/** The headline cell: cost of goods, its share of sales, the prior figure. */
function Headline({ c, column }: { c: StockCogsComparison; column: string }) {
  return (
    <td className="cogs-cell" data-column={column}>
      <span className="cogs-value">{money(c.current.cogsCents)}</span>
      <span className="cogs-sub">{percent(c.current.cogsPercent)} of {money(c.current.salesCents)} sales</span>
      <span className="cogs-prior">
        <Delta value={pp(c.current.cogsPercent, c.prior.cogsPercent)} unit="pp" good="down" label="Change in cost of goods as a share of sales" />
        <span>prior {money(c.prior.cogsCents)}{c.prior.cogsPercent !== null ? ` · ${percent(c.prior.cogsPercent)}` : ''}</span>
      </span>
    </td>
  );
}

/** One period's full breakdown, used inside an expanded row. */
function Detail({ c, title, sub }: { c: StockCogsComparison; title: string; sub: string }) {
  const cur = c.current;
  const pri = c.prior;
  const d = cur.detail;
  const lines: Array<{ label: string; value: string; prior: string; delta: JSX.Element }> = [
    { label: 'Revenue', value: money(cur.salesCents), prior: money(pri.salesCents), delta: <Delta value={rel(cur.salesCents, pri.salesCents)} good="up" /> },
    { label: 'Cost of goods', value: money(cur.cogsCents), prior: money(pri.cogsCents), delta: <Delta value={rel(cur.cogsCents, pri.cogsCents)} good="none" label="Dollars: read with revenue" /> },
    { label: 'COGS % of revenue', value: percent(cur.cogsPercent), prior: percent(pri.cogsPercent), delta: <Delta value={pp(cur.cogsPercent, pri.cogsPercent)} unit="pp" good="down" /> },
    { label: 'Gross profit', value: money(gp(cur)), prior: money(gp(pri)), delta: <Delta value={rel(gp(cur), gp(pri))} good="up" /> },
    { label: 'Gross margin', value: percent(gm(cur)), prior: percent(gm(pri)), delta: <Delta value={pp(gm(cur), gm(pri))} unit="pp" good="up" /> }
  ];
  const buckets = d
    ? [
        { label: 'Food', cents: d.foodCogsCents, prior: pri.detail?.foodCogsCents ?? null, key: 'food' },
        { label: 'Beverage', cents: d.bevCogsCents, prior: pri.detail?.bevCogsCents ?? null, key: 'beverage' },
        { label: 'Other direct costs', cents: d.otherCogsCents, prior: pri.detail?.otherCogsCents ?? null, key: 'other' }
      ].filter((b) => b.cents !== 0 || (b.prior ?? 0) !== 0)
    : [];
  return (
    <div className="cogs-detail">
      <h4>{title}<span>{sub}</span></h4>
      <table className="cogs-detail-table">
        <thead>
          <tr><th>Measure</th><th>{shortDate(c.from)}–{shortDate(c.to)}</th><th>Prior</th><th>Change</th></tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.label}><th scope="row">{l.label}</th><td>{l.value}</td><td>{l.prior}</td><td>{l.delta}</td></tr>
          ))}
        </tbody>
      </table>
      {buckets.length ? (
        <>
          <h5>What is in cost of goods</h5>
          <table className="cogs-detail-table">
            <tbody>
              {buckets.map((b) => (
                <tr key={b.key}>
                  <th scope="row">{b.label}</th>
                  <td>{money(b.cents)}<span className="cogs-detail-share"> · {cur.cogsCents ? percent((b.cents / cur.cogsCents) * 100, 0) : '—'}</span></td>
                  <td>{b.prior === null ? '—' : money(b.prior)}</td>
                  <td>{b.prior === null ? <Delta value={null} good="none" /> : <Delta value={rel(b.cents, b.prior)} good="none" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d && d.accounts.length ? (
            <details className="cogs-accounts">
              <summary>{d.accounts.length} Xero account{d.accounts.length === 1 ? '' : 's'}</summary>
              <ul>
                {[...d.accounts].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents)).map((a) => (
                  <li key={a.name}><span>{a.name}</span><span>{money(a.cents)}</span></li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <p className="subtle">Xero returned no account lines for this period.</p>
      )}
    </div>
  );
}

function Row({ row, open, onToggle }: { row: StockCogsRow; open: boolean; onToggle: () => void }) {
  const id = `cogs-detail-${row.label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <Fragment>
      <tr className={`${row.venue ? '' : 'cogs-group-row'}${open ? ' is-open' : ''}`}>
        <th scope="row">
          <button type="button" className="cogs-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
            <span className="cogs-chevron" aria-hidden>{open ? '▾' : '▸'}</span>
            {row.label}
          </button>
        </th>
        {PERIODS.map((key) => {
          const h = heading(key, row);
          return <Headline key={key} c={row[key]} column={`${h.title} · ${h.sub}`} />;
        })}
      </tr>
      {open ? (
        <tr className="cogs-detail-row" id={id}>
          <td colSpan={5}>
            <div className="cogs-detail-grid">
              {PERIODS.map((key) => {
                const h = heading(key, row);
                return <Detail key={key} c={row[key]} title={h.title} sub={h.sub} />;
              })}
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

export function CogsSection({ cogs, error }: { cogs: StockCogsOverviewPayload | null; error: string | null }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const first = cogs?.rows[0];
  const allOpen = cogs ? cogs.rows.every((r) => open[r.label]) : false;
  return (
    <section className="home-section" aria-labelledby="home-cogs-title">
      <header className="home-section-head">
        <div>
          <h2 id="home-cogs-title">Cost of goods</h2>
          <p>
            Xero's Cost of Sales for each venue's organisation, accrual basis, ex GST — the figure the accounts will show. Only as current as the bills entered in Xero.
            {cogs ? ` Refreshed ${new Date(cogs.lastRefreshed).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}.` : ''}
          </p>
        </div>
        <div className="home-section-actions">
          <span className="home-source">Source: Xero</span>
          {cogs ? (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(Object.fromEntries(cogs.rows.map((r) => [r.label, !allOpen])))}>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          ) : null}
        </div>
      </header>
      <div className="home-card home-card-flush">
        {error ? (
          <div className="home-card-empty"><strong>Cost of goods unavailable.</strong> {error}</div>
        ) : !cogs ? (
          <div className="home-card-empty"><Spinner label="Reading the Xero profit and loss" /></div>
        ) : (
          <div className="stock-dashboard-table-scroll">
            <table className="cogs-table">
              <thead>
                <tr>
                  <th />
                  {PERIODS.map((key) => {
                    const h = heading(key, first!);
                    return <th key={key}>{h.title}<span className="cogs-head-sub">{h.sub}</span></th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {cogs.rows.map((row) => (
                  <Row key={row.label} row={row} open={Boolean(open[row.label])} onToggle={() => setOpen((o) => ({ ...o, [row.label]: !o[row.label] }))} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {cogs?.notes.length ? (
        <ul className="subtle cogs-notes">
          {cogs.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      ) : null}
      <p className="home-legend">
        <Delta value={2.1} unit="pp" good="down" /> share of sales moved the wrong way ·
        <Delta value={-2.1} unit="pp" good="down" /> the right way ·
        <Delta value={4} good="none" /> dollars, read with revenue · pp = percentage points
      </p>
    </section>
  );
}
