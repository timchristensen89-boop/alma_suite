import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { StocktakeCountSheet, StocktakeCountSheetRow } from '@alma/shared';
import { isPreparedStockCategory } from '@alma/shared';
import { Button, EmptyState, Spinner } from '@alma/ui';
import { IconStocktake } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import { useAuth } from '../lib/auth';

/**
 * The paper count sheet.
 *
 * A working document, not a report: categories in walking order, wines
 * grouped by name with their vintages under them, one short row per line
 * with a box to write in, two columns to the A4 page so a bar sheet is a
 * few pages rather than a dozen. Headings repeat when a table crosses a
 * page, rows never split. Values never print; expected quantities print
 * only when the sheet is deliberately not blind.
 *
 * Reached from a count (`/stocktake/:id/print`) or straight from a template
 * before a count exists (`/stocktake-templates/:id/print`).
 */

const COUNT_SHEET_OPTIONS_KEY = 'alma-stock-count-sheet-options-v2';

type SheetOptions = {
  blind: boolean;
  twoColumns: boolean;
  notes: boolean;
  tally: boolean;
};

const DEFAULT_OPTIONS: SheetOptions = { blind: true, twoColumns: true, notes: false, tally: false };

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

function rowName(row: StocktakeCountSheetRow) {
  if (row.group) return row.vintageDetail ?? '';
  return row.wineName ?? row.label;
}

// A prepared product prints its container, so a part-container can be
// written as litres or kilos: "1 container = 5 L".
function containerNote(row: StocktakeCountSheetRow) {
  if (!isPreparedStockCategory(row.category) || !row.purchaseUnit || !row.conversionFactor) return null;
  return `1 ${row.purchaseUnit} = ${formatQty(row.conversionFactor)} ${row.unit}`;
}

function rowVintage(row: StocktakeCountSheetRow) {
  return row.vintage && row.vintage !== 'No year' ? row.vintage : '';
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

  const venueParam = searchParams.get('venue');
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const path =
      source === 'stocktake'
        ? `/api/stocktake/${id}/count-sheet?blind=${options.blind ? '1' : '0'}`
        : `/api/stocktake-templates/${id}/count-sheet?blind=${options.blind ? '1' : '0'}${venueParam ? `&venue=${encodeURIComponent(venueParam)}` : ''}`;
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
  }, [id, source, options.blind, venueParam]);

  const backTo = source === 'stocktake' ? '/stocktake' : '/stocktake-templates';
  const counterName = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '';
  const alreadyCounted = useMemo(
    () => sheet?.sections.reduce((sum, section) => sum + section.rows.filter((row) => row.countedQty !== null).length, 0) ?? 0,
    [sheet]
  );

  function toggle(key: keyof SheetOptions) {
    setOptions((current) => ({ ...current, [key]: !current[key] }));
  }

  async function downloadExcel() {
    if (!id || !sheet) return;
    const path = source === 'stocktake' ? `/api/stocktake/${id}/export.xlsx` : `/api/stocktake-templates/${id}/export.xlsx${venueParam ? `?venue=${encodeURIComponent(venueParam)}` : ''}`;
    try {
      await downloadCsv(path, `${sheet.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.xlsx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download the Excel sheet');
    }
  }

  const columns = 4 + (options.blind ? 0 : 1) + (options.tally ? 1 : 0) + (options.notes ? 1 : 0);

  return (
    <div className={`count-sheet-page${options.twoColumns ? ' is-two-col' : ''}`}>
      <div className="count-sheet-toolbar" role="toolbar" aria-label="Print options">
        <div className="count-sheet-toolbar-left">
          <Link to={backTo} className="link">← Back to {source === 'stocktake' ? 'counts' : 'templates'}</Link>
          <span className="subtle">
            {sheet ? `${sheet.lineCount} lines · ${sheet.sections.length} categories` : 'Loading…'}
            {alreadyCounted > 0 ? ` · ${alreadyCounted} already counted in the app` : ''}
          </span>
        </div>
        <div className="count-sheet-toolbar-options">
          <label className="count-sheet-option"><input type="checkbox" checked={options.twoColumns} onChange={() => toggle('twoColumns')} /> Two columns</label>
          <label className="count-sheet-option"><input type="checkbox" checked={!options.blind} onChange={() => toggle('blind')} /> Expected qty</label>
          <label className="count-sheet-option"><input type="checkbox" checked={options.tally} onChange={() => toggle('tally')} /> Tally box</label>
          <label className="count-sheet-option"><input type="checkbox" checked={options.notes} onChange={() => toggle('notes')} /> Notes column</label>
        </div>
        <div className="count-sheet-toolbar-actions">
          <Button type="button" variant="secondary" onClick={() => void downloadExcel()} disabled={!sheet}>Excel</Button>
          <Button type="button" onClick={() => window.print()} disabled={!sheet}>Print</Button>
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
              <h1>{sheet.name}</h1>
              <span>
                {sheet.venue ?? 'Venue not set'} · {formatSheetDate(sheet.countedAt)}
                {sheet.template && sheet.template !== sheet.name ? ` · ${sheet.template}` : ''} · {sheet.lineCount} lines
                {sheet.blind ? '' : ' · expected shown'}
              </span>
            </div>
            <div className="count-sheet-signoff">
              <span>Counted by <b>{counterName || ' '}</b></span>
              <span>Checked by <b>&nbsp;</b></span>
              <span>Page <b className="count-sheet-pageno">&nbsp;</b></span>
            </div>
          </header>
          <p className="count-sheet-note">
            Write what you see, in the unit shown. None on the shelf: <strong>0</strong>. Part bottles as decimals (0.5). A line left blank is recorded as <strong>zero</strong> when the count is submitted.
          </p>

          <div className="count-sheet-columns">
            {sheet.sections.map((section) => (
              <section key={section.area} className="count-sheet-section">
                <table className="count-sheet-table">
                  <colgroup>
                    <col className="col-item" />
                    <col className="col-vint" />
                    <col className="col-unit" />
                    {!sheet.blind ? <col className="col-num" /> : null}
                    {options.tally ? <col className="col-tally" /> : null}
                    <col className="col-count" />
                    {options.notes ? <col className="col-notes" /> : null}
                  </colgroup>
                  <thead>
                    <tr className="count-sheet-section-row">
                      <th colSpan={columns}>
                        {section.area}
                        <span className="count-sheet-section-count">{section.rows.length}</span>
                      </th>
                    </tr>
                    <tr>
                      <th className="col-item">Item</th>
                      <th className="col-vint">Vint.</th>
                      <th className="col-unit">Unit</th>
                      {!sheet.blind ? <th className="col-num">Exp.</th> : null}
                      {options.tally ? <th className="col-tally">Tally</th> : null}
                      <th className="col-count">Count</th>
                      {options.notes ? <th className="col-notes">Notes</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row, index) => {
                      const previous = index > 0 ? section.rows[index - 1] : null;
                      const startsGroup = Boolean(row.group) && row.group !== previous?.group;
                      return (
                        <Fragment key={row.lineId ?? row.itemId ?? row.recipeId ?? `${section.area}-${index}`}>
                          {startsGroup ? (
                            <tr className="count-sheet-group-row">
                              <td colSpan={columns}>{row.group}</td>
                            </tr>
                          ) : null}
                          <tr className={`${row.kind === 'PREPPED_ITEM' ? 'is-prep' : ''}${row.group ? ' is-vintage' : ''}`}>
                            <td className="col-item">{row.group ? <span className="count-sheet-vintage-only">{rowVintage(row) || row.vintage}{rowName(row) ? ` · ${rowName(row)}` : ''}</span> : (
                              <>
                                {rowName(row)}
                                {containerNote(row) ? <span className="count-sheet-container"> · {containerNote(row)}</span> : null}
                              </>
                            )}</td>
                            <td className="col-vint">{row.group ? '' : rowVintage(row)}</td>
                            <td className="col-unit">{row.unit || '—'}</td>
                            {!sheet.blind ? <td className="col-num">{formatQty(row.expectedQty)}</td> : null}
                            {options.tally ? <td className="col-tally" /> : null}
                            <td className="col-count">{row.countedQty !== null ? <span className="count-sheet-prefilled">{formatQty(row.countedQty)}</span> : null}</td>
                            {options.notes ? <td className="col-notes">{row.notes ? <span className="count-sheet-prefilled">{row.notes}</span> : null}</td> : null}
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        </article>
      )}
    </div>
  );
}
