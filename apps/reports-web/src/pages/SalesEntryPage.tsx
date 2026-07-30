// Sales entry — manual week grid and CSV upload.
//
// This is now the PRIMARY way sales reach the forecast: Square is
// disconnected and the Lightspeed API is not being paid for. So the job here
// is to make end-of-week entry fast enough that it actually happens, and to
// make the GST basis impossible to get wrong by accident.
//
// SalesActualEntry stores GST-EXCLUSIVE sales. Till takings are GST
// inclusive. The basis selector is therefore prominent and always visible,
// and the grid shows the converted figure live as you type.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Select, Spinner } from '@alma/ui';
import { staffApi, staffApiText } from '../lib/api';

type GstBasis = 'INCLUSIVE' | 'EXCLUSIVE';

const DAY_MS = 24 * 60 * 60 * 1000;

function mondayOf(date: Date): Date {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay();
  return new Date(copy.getTime() + (day === 0 ? -6 : 1 - day) * DAY_MS);
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

function money(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 }).format(cents / 100);
}

/** Dollars typed by a human → cents. Tolerates $ and thousands separators. */
function toCents(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  if (!/^\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}

const GST_DIVISOR = 1.1;
const toExGst = (cents: number, basis: GstBasis) => (basis === 'INCLUSIVE' ? Math.round(cents / GST_DIVISOR) : cents);

/** The source written by the manual grid. Re-saving a day replaces this row. */
const MANUAL_SOURCE = 'manual';

export function SalesEntryPage() {
  // Venue names come from settings, the same source the API validates against.
  const [venues, setVenues] = useState<string[]>([]);
  const [venue, setVenue] = useState('');
  const [basis, setBasis] = useState<GstBasis>('INCLUSIVE');
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date(Date.now() - 7 * DAY_MS)));
  const [values, setValues] = useState<Record<string, string>>({});
  // Every entry per day, NOT one — reports sum salesCents across sources, so a
  // day holding both a POS figure and a manual one is counted twice. The grid
  // has to show all of them or the double count is invisible.
  const [existing, setExisting] = useState<Record<string, Array<{ salesCents: number; source: string }>>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  // CSV upload state
  const [csvText, setCsvText] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [uploading, setUploading] = useState(false);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => new Date(weekStart.getTime() + index * DAY_MS)),
    [weekStart],
  );

  useEffect(() => {
    void (async () => {
      try {
        const settings = await staffApi<{ venues?: Array<{ name: string }> }>('/api/settings');
        const names = (settings.venues ?? []).map((entry) => entry.name).filter(Boolean);
        setVenues(names);
        setVenue((current) => current || (names[0] ?? ''));
      } catch {
        // Leave the page usable: the grid simply waits for a venue.
      }
    })();
  }, []);

  const loadWeek = useCallback(async () => {
    if (!venue) return;
    setLoading(true);
    try {
      const from = iso(days[0] as Date);
      const to = iso(days[6] as Date);
      const data = await staffApi<{ entries: Array<{ serviceDate: string; venue: string; salesCents: number; source: string }> }>(
        `/api/reports/sales/range?venue=${encodeURIComponent(venue)}&from=${from}&to=${to}`,
      );
      const map: Record<string, Array<{ salesCents: number; source: string }>> = {};
      for (const entry of data.entries) {
        if (entry.venue !== venue) continue;
        (map[entry.serviceDate] ??= []).push({ salesCents: entry.salesCents, source: entry.source });
      }
      setExisting(map);
      setValues({});
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Could not load the week.' });
    } finally {
      setLoading(false);
    }
  }, [days, venue]);

  useEffect(() => {
    void loadWeek();
  }, [loadWeek]);

  const rows = days.map((date) => {
    const key = iso(date);
    const typed = values[key] ?? '';
    const cents = toCents(typed);
    const dayEntries = existing[key] ?? [];
    // A figure already recorded by something other than manual entry. Saving
    // alongside it adds to it rather than replacing it.
    const otherSources = dayEntries.filter((entry) => entry.source !== MANUAL_SOURCE);
    return {
      key,
      date,
      typed,
      cents,
      invalid: typed.trim() !== '' && cents === null,
      exGstCents: cents === null ? null : toExGst(cents, basis),
      entries: dayEntries,
      otherSources,
    };
  });

  const enteredRows = rows.filter((row) => row.cents !== null && !row.invalid);
  const weekTotalExGst = enteredRows.reduce((sum, row) => sum + (row.exGstCents ?? 0), 0);
  const hasInvalid = rows.some((row) => row.invalid);
  // Days about to be entered that a POS feed already covers.
  const clashes = enteredRows.filter((row) => row.otherSources.length > 0);

  async function saveWeek() {
    if (enteredRows.length === 0 || hasInvalid) return;
    setSaving(true);
    setMessage(null);
    try {
      await staffApi('/api/reports/sales/import', {
        method: 'POST',
        body: JSON.stringify({
          source: 'manual',
          rows: enteredRows.map((row) => ({
            venue,
            serviceDate: row.key,
            // Always send the GST-EXCLUSIVE figure the forecast stores.
            salesCents: row.exGstCents,
          })),
        }),
      });
      setMessage({
        tone: 'success',
        text: `Saved ${enteredRows.length} day${enteredRows.length === 1 ? '' : 's'} for ${venue}. Stored GST exclusive.`,
      });
      await loadWeek();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  }

  async function runCsv(dryRun: boolean) {
    if (!csvText.trim()) return;
    setUploading(true);
    setMessage(null);
    try {
      const result = await staffApi<any>('/api/reports/sales/import-csv', {
        method: 'POST',
        body: JSON.stringify({ csv: csvText, gstBasis: basis, venue, source: 'csv', dryRun }),
      });
      setPreview(result);
      if (!dryRun) {
        setMessage({ tone: 'success', text: `Imported ${result.imported} row${result.imported === 1 ? '' : 's'}.` });
        setCsvText('');
        setCsvFileName('');
        await loadWeek();
      }
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Could not read the file.' });
    } finally {
      setUploading(false);
    }
  }

  function downloadCsv(text: string, fileName: string) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function downloadTemplate() {
    try {
      downloadCsv(await staffApiText('/api/reports/sales/template.csv'), 'alma-sales-template.csv');
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Could not download the template.' });
    }
  }

  return (
    <div className="page-stack">
      <Card
        title="Sales entry"
        subtitle="Enter takings by hand or upload a file. This is what feeds the forecast now that the POS is not connected."
        action={
          <div className="forecast-venue-tabs">
            {venues.map((option) => (
              <button key={option} type="button" className={venue === option ? 'is-active' : undefined} onClick={() => setVenue(option)}>
                {option}
              </button>
            ))}
          </div>
        }
      >
        {/* The single most important control on the page. */}
        <div className="se-basis">
          <div className="se-basis-label">
            <strong>The figures I am entering are</strong>
            <span className="subtle">Stored figures are always GST exclusive. Till takings include GST.</span>
          </div>
          <Select
            label=""
            value={basis}
            onChange={(event) => setBasis(event.currentTarget.value as GstBasis)}
            options={[
              { label: 'Gross takings, including GST', value: 'INCLUSIVE' },
              { label: 'Net sales, excluding GST', value: 'EXCLUSIVE' },
            ]}
          />
          <Badge tone={basis === 'INCLUSIVE' ? 'info' : 'neutral'}>
            {basis === 'INCLUSIVE' ? 'GST removed on save' : 'Stored as entered'}
          </Badge>
        </div>

        {message ? <p className={message.tone === 'error' ? 'error-text' : 'se-success'}>{message.text}</p> : null}
      </Card>

      <Card
        title="Week"
        subtitle={`${iso(days[0] as Date)} to ${iso(days[6] as Date)}`}
        action={
          <div className="forecast-venue-tabs">
            <button type="button" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY_MS))}>‹ Previous</button>
            <button type="button" onClick={() => setWeekStart(mondayOf(new Date(Date.now() - 7 * DAY_MS)))}>Last week</button>
            <button type="button" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY_MS))}>Next ›</button>
          </div>
        }
      >
        {loading ? (
          <div className="forecast-loading"><Spinner /> Loading…</div>
        ) : (
          <>
            <div className="table-scroll">
              <table className="forecast-table se-grid">
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Takings</th>
                    <th className="num">Stored (ex GST)</th>
                    <th>Already recorded (ex GST)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <strong>{row.date.toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'UTC' })}</strong>{' '}
                        <span className="subtle">{row.date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
                      </td>
                      <td>
                        <input
                          className={`se-input${row.invalid ? ' is-invalid' : ''}`}
                          inputMode="decimal"
                          // Deliberately NOT the stored figure: this field is
                          // in the selected basis (often GST inclusive), and
                          // echoing the ex-GST amount here reads as "you
                          // entered this" when the operator entered 10% more.
                          placeholder="0.00"
                          value={row.typed}
                          onChange={(event) => setValues((current) => ({ ...current, [row.key]: event.target.value }))}
                        />
                      </td>
                      <td className="num">{row.exGstCents === null ? '—' : money(row.exGstCents)}</td>
                      <td>
                        {row.entries.length === 0 ? (
                          <span className="subtle">—</span>
                        ) : (
                          <div className="se-recorded">
                            {row.entries.map((entry) => (
                              <span key={entry.source} className="subtle">
                                {money(entry.salesCents)}{' '}
                                <Badge tone={entry.source === MANUAL_SOURCE ? 'neutral' : 'warning'}>{entry.source}</Badge>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="se-actions">
              <div className="subtle">
                {enteredRows.length} day{enteredRows.length === 1 ? '' : 's'} entered · week total{' '}
                <strong>{money(weekTotalExGst)}</strong> ex GST
              </div>
              <Button type="button" onClick={() => void saveWeek()} disabled={saving || enteredRows.length === 0 || hasInvalid}>
                {saving ? 'Saving…' : `Save ${enteredRows.length || ''} day${enteredRows.length === 1 ? '' : 's'}`}
              </Button>
            </div>
            {hasInvalid ? <p className="error-text">One or more amounts are not valid numbers.</p> : null}
            {clashes.length > 0 ? (
              <div className="se-warning">
                <strong>
                  {clashes.length} day{clashes.length === 1 ? '' : 's'} already {clashes.length === 1 ? 'has' : 'have'} a
                  figure from another source.
                </strong>
                <p>
                  Reports add every source together for a day, so saving here counts that day twice. Remove the other
                  figure under Reports → Sales first, or leave these days blank.
                </p>
                <ul>
                  {clashes.map((row) => (
                    <li key={row.key}>
                      {row.key} — already {money(row.otherSources[0]!.salesCents)} from{' '}
                      <strong>{row.otherSources.map((entry) => entry.source).join(', ')}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="subtle se-note">
              Saving a day that is already recorded updates it rather than adding a second entry, so re-entering a week
              cannot double count.
            </p>
          </>
        )}
      </Card>

      <Card
        title="Upload a file"
        subtitle={`CSV with a date, a venue and an amount. Column names are flexible, a file may cover both venues, and rows without a venue are treated as ${venue || 'the selected venue'}. Nothing is saved until you check it first.`}
        action={
          <Button type="button" size="sm" variant="ghost" onClick={() => void downloadTemplate()}>
            Download template
          </Button>
        }
      >
        <input
          type="file"
          accept=".csv,text/csv"
          className="se-file"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setCsvFileName(file.name);
            setCsvText(await file.text());
            setPreview(null);
          }}
        />
        {csvFileName ? <p className="subtle">{csvFileName}</p> : null}

        <div className="se-actions">
          <Button type="button" variant="secondary" onClick={() => void runCsv(true)} disabled={uploading || !csvText.trim()}>
            {uploading ? 'Checking…' : 'Check file'}
          </Button>
          <Button
            type="button"
            onClick={() => void runCsv(false)}
            disabled={uploading || !preview || preview.validRows === 0}
          >
            Import {preview?.validRows ? `${preview.validRows} row${preview.validRows === 1 ? '' : 's'}` : ''}
          </Button>
        </div>

        {preview ? (
          <div className="se-preview">
            <div className="stat-grid">
              <div className="stat-card"><div className="stat-card-label">Rows read</div><div className="stat-card-value">{preview.totalRows}</div></div>
              <div className="stat-card"><div className="stat-card-label">Will import</div><div className="stat-card-value">{preview.validRows}</div></div>
              <div className={`stat-card${preview.errorRows ? ' tone-danger' : ''}`}><div className="stat-card-label">Problems</div><div className="stat-card-value">{preview.errorRows}</div></div>
            </div>

            {preview.clashes?.length ? (
              <div className="se-warning">
                <strong>
                  {preview.clashes.length} of these days already {preview.clashes.length === 1 ? 'has' : 'have'} a figure
                  from another source.
                </strong>
                <p>
                  Reports add every source together for a day, so importing these counts them twice. Remove the other
                  figures under Reports → Sales first, or cut those rows from the file.
                </p>
                <ul>
                  {preview.clashes.slice(0, 8).map((clash: any) => (
                    <li key={`${clash.venue}-${clash.serviceDate}-${clash.source}`}>
                      {clash.serviceDate} · {clash.venue} — already {money(clash.salesCents)} from{' '}
                      <strong>{clash.source}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {preview.basisFromFile ? (
              <p className="subtle">The file named its own GST basis per column, so that was used instead of the selector above.</p>
            ) : null}

            {preview.errorRows > 0 ? (
              <>
                <div className="table-scroll">
                  <table className="forecast-table">
                    <thead><tr><th>Row</th><th>Column</th><th>Problem</th></tr></thead>
                    <tbody>
                      {preview.errors.slice(0, 12).map((error: any, index: number) => (
                        <tr key={index}><td>{error.rowNumber}</td><td className="subtle">{error.column ?? '—'}</td><td>{error.message}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => downloadCsv(preview.errorReportCsv ?? '', 'sales-import-errors.csv')}
                >
                  Download error report
                </Button>
              </>
            ) : null}

            {preview.preview?.length ? (
              <div className="table-scroll">
                <table className="forecast-table">
                  <thead><tr><th>Date</th><th>Venue</th><th className="num">Entered</th><th className="num">Stored (ex GST)</th></tr></thead>
                  <tbody>
                    {preview.preview.map((row: any) => (
                      <tr key={`${row.venue}-${row.serviceDate}`}>
                        <td>{row.serviceDate}</td>
                        <td>{row.venue}</td>
                        <td className="num">{money(row.enteredCents)} <span className="subtle">{row.enteredBasis === 'INCLUSIVE' ? 'inc' : 'ex'}</span></td>
                        <td className="num"><strong>{money(row.salesCents)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {preview.validRows > preview.preview.length ? (
              <p className="subtle">
                Showing the first {preview.preview.length} of {preview.validRows} rows. All {preview.validRows} will be
                imported.
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
