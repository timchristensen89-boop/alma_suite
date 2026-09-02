import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { StocktakeCountSheet, StocktakeCountSheetRow } from '@alma/shared';
import { Button, EmptyState, Spinner } from '@alma/ui';
import { IconStocktake } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * The paper count sheet.
 *
 * Staff told us it is easier to print a sheet and write on it than to count
 * into any app, so the sheet is a first-class output rather than a screenshot
 * of the count screen: the venue walk in order, one row per line, a box to
 * write in, and nothing on it that a counter does not need. Values never
 * print; expected quantities print only when the sheet is deliberately not
 * blind. What is written on paper is keyed in afterwards on the same count —
 * the Count button on the stocktake — so the ledger flow is unchanged.
 *
 * Reached from a stocktake (`/stocktake/:id/print`) or straight from a
 * template before a count exists (`/stocktake-templates/:id/print`).
 */

const COUNT_SHEET_OPTIONS_KEY = 'alma-stock-count-sheet-options';

type SheetOptions = {
  blind: boolean;
  showPar: boolean;
  showSku: boolean;
  tallyBoxes: boolean;
  compact: boolean;
};

const DEFAULT_OPTIONS: SheetOptions = { blind: true, showPar: false, showSku: false, tallyBoxes: true, compact: false };

function readStoredOptions(): Partial<SheetOptions> {
  try {
    const raw = window.localStorage.getItem(COUNT_SHEET_OPTIONS_KEY);
    return raw ? (JSON.parse(raw) as Partial<SheetOptions>) : {};
  } catch {
    return {};
  }
}

function storeOptions(options: SheetOptions) {
  try {
    window.localStorage.setItem(COUNT_SHEET_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    /* private mode — the sheet still prints */
  }
}

function formatQty(value: number | null) {
  if (value === null || value === undefined) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

function formatSheetDate(iso: string | null) {
  const date = iso ? new Date(iso) : new Date();
  return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function unitHint(row: StocktakeCountSheetRow) {
  if (row.purchaseUnit && row.conversionFactor && row.conversionFactor !== 1) {
    return `1 ${row.purchaseUnit} = ${formatQty(row.conversionFactor)} ${row.unit}`;
  }
  return null;
}

export function CountSheetPage({ source }: { source: 'stocktake' | 'template' }) {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [sheet, setSheet] = useState<StocktakeCountSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<SheetOptions>(() => {
    const stored = readStoredOptions();
    const blindParam = searchParams.get('blind');
    return {
      ...DEFAULT_OPTIONS,
      ...stored,
      ...(blindParam !== null ? { blind: blindParam !== '0' && blindParam !== 'false' } : {})
    };
  });

  useDocumentTitle(sheet ? `Count sheet · ${sheet.name}` : 'Count sheet');

  useEffect(() => {
    storeOptions(options);
  }, [options]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const path =
      source === 'stocktake'
        ? `/api/stocktake/${id}/count-sheet?blind=${options.blind ? '1' : '0'}`
        : `/api/stocktake-templates/${id}/count-sheet?blind=${options.blind ? '1' : '0'}`;
    void (async () => {
      try {
        const payload = await api<StocktakeCountSheet>(path);
        if (!cancelled) setSheet(payload);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the count sheet.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, source, options.blind]);

  const backTo = source === 'stocktake' ? '/stocktake' : '/stocktake-templates';
  const counterName = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '';
  const alreadyCounted = useMemo(
    () => sheet?.sections.reduce((sum, section) => sum + section.rows.filter((row) => row.countedQty !== null).length, 0) ?? 0,
    [sheet]
  );

  function toggle(key: keyof SheetOptions) {
    setOptions((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <div className={`count-sheet-page${options.compact ? ' is-compact' : ''}`}>
      <div className="count-sheet-toolbar" role="toolbar" aria-label="Print options">
        <div className="count-sheet-toolbar-left">
          <Link to={backTo} className="link">← Back to {source === 'stocktake' ? 'stocktakes' : 'templates'}</Link>
          <span className="subtle">
            {sheet ? `${sheet.lineCount} lines · ${sheet.sections.length} areas` : 'Loading…'}
            {alreadyCounted > 0 ? ` · ${alreadyCounted} already counted in the app` : ''}
          </span>
        </div>
        <div className="count-sheet-toolbar-options">
          <label className="count-sheet-option">
            <input type="checkbox" checked={options.blind} onChange={() => toggle('blind')} />
            Blind (hide expected)
          </label>
          <label className="count-sheet-option">
            <input type="checkbox" checked={options.tallyBoxes} onChange={() => toggle('tallyBoxes')} />
            Tally boxes
          </label>
          <label className="count-sheet-option">
            <input type="checkbox" checked={options.showPar} onChange={() => toggle('showPar')} />
            Par
          </label>
          <label className="count-sheet-option">
            <input type="checkbox" checked={options.showSku} onChange={() => toggle('showSku')} />
            SKU
          </label>
          <label className="count-sheet-option">
            <input type="checkbox" checked={options.compact} onChange={() => toggle('compact')} />
            Compact
          </label>
        </div>
        <div className="count-sheet-toolbar-actions">
          <Button type="button" onClick={() => window.print()} disabled={!sheet}>
            Print sheet
          </Button>
        </div>
      </div>

      {loading ? (
        <Spinner label="Building the count sheet" />
      ) : error || !sheet ? (
        <EmptyState icon={<IconStocktake size={24} />} title="Count sheet unavailable" description={error ?? 'Nothing to print.'} />
      ) : (
        <article className="count-sheet" aria-label={`Count sheet for ${sheet.name}`}>
          <header className="count-sheet-head">
            <div className="count-sheet-title">
              <span className="count-sheet-eyebrow">Alma Stock · Count sheet{sheet.blind ? ' · blind' : ''}</span>
              <h1>{sheet.name}</h1>
              <p className="count-sheet-meta">
                {sheet.venue ?? 'Venue not set'} · {formatSheetDate(sheet.countedAt)}
                {sheet.template && sheet.template !== sheet.name ? ` · ${sheet.template}` : ''}
                {sheet.source === 'template' ? ' · blank sheet, count not started in the app yet' : ''}
              </p>
            </div>
            <dl className="count-sheet-signoff">
              <div>
                <dt>Counted by</dt>
                <dd>{counterName || ' '}</dd>
              </div>
              <div>
                <dt>Checked by</dt>
                <dd>&nbsp;</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>&nbsp;</dd>
              </div>
              <div>
                <dt>Finished</dt>
                <dd>&nbsp;</dd>
              </div>
            </dl>
          </header>

          <p className="count-sheet-instructions">
            Write what you see, in the unit shown. Empty shelf: write <strong>0</strong>. Could not check it: write{' '}
            <strong>NC</strong> — a line left blank is recorded as zero when the count is submitted. Part bottles and
            part cases go as decimals (0.5). Key the sheet into the app on the same count before it is submitted.
          </p>

          {sheet.sections.map((section, sectionIndex) => (
            <section key={section.area} className="count-sheet-section">
              <h2>
                <span className="count-sheet-section-index">{sectionIndex + 1}</span>
                {section.area}
                <span className="count-sheet-section-count">{section.rows.length} lines</span>
              </h2>
              <table className="count-sheet-table">
                <thead>
                  <tr>
                    <th className="col-index">#</th>
                    <th className="col-item">Item</th>
                    <th className="col-unit">Unit</th>
                    {!sheet.blind ? <th className="col-num">Expected</th> : null}
                    {options.showPar ? <th className="col-num">Par</th> : null}
                    {options.tallyBoxes ? <th className="col-tally">Tally</th> : null}
                    <th className="col-count">Count</th>
                    <th className="col-notes">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row, rowIndex) => {
                    const hint = unitHint(row);
                    return (
                      <tr key={row.lineId ?? row.itemId ?? row.recipeId ?? `${section.area}-${rowIndex}`} className={row.kind === 'PREPPED_ITEM' ? 'is-prep' : undefined}>
                        <td className="col-index">{rowIndex + 1}</td>
                        <td className="col-item">
                          <span className="count-sheet-item-name">{row.label}</span>
                          <span className="count-sheet-item-sub">
                            {[
                              options.showSku && row.sku ? row.sku : null,
                              row.category && row.category !== section.area ? row.category : null,
                              row.kind === 'PREPPED_ITEM' ? 'made item' : null
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </td>
                        <td className="col-unit">
                          {row.unit || '—'}
                          {hint ? <span className="count-sheet-unit-hint">{hint}</span> : null}
                        </td>
                        {!sheet.blind ? <td className="col-num">{formatQty(row.expectedQty)}</td> : null}
                        {options.showPar ? <td className="col-num">{formatQty(row.parLevel)}</td> : null}
                        {options.tallyBoxes ? <td className="col-tally" /> : null}
                        <td className="col-count">
                          {row.countedQty !== null ? <span className="count-sheet-prefilled">{formatQty(row.countedQty)}</span> : null}
                        </td>
                        <td className="col-notes">{row.notes ? <span className="count-sheet-prefilled">{row.notes}</span> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}

          <footer className="count-sheet-foot">
            <span>
              {sheet.lineCount} lines · printed {new Date(sheet.generatedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
              {counterName ? ` by ${counterName}` : ''}
            </span>
            <span>Enter the counts in Alma Stock → Stock count → Count, then a manager submits and applies.</span>
          </footer>
        </article>
      )}
    </div>
  );
}
