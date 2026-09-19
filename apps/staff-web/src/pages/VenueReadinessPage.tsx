// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StaffProfile } from '@alma/shared';
import { Badge, Button, Card, Input, PageHeader, Select } from '@alma/ui';
import { api } from '../lib/api';
import { toDateInput, uniqueValues } from '../lib/datetime';
import { type ReadinessRow, type ReadinessPayload, readinessLabel } from './shared';

function readinessTone(status: ReadinessRow['status']): 'positive' | 'warning' | 'danger' | 'muted' {
  if (status === 'GREEN') return 'positive';
  if (status === 'AMBER') return 'warning';
  if (status === 'RED') return 'danger';
  return 'muted'; // MISSING
}

export function VenueReadinessPage({ staff }: { staff: StaffProfile[] }) {
  const [payload, setPayload] = useState<ReadinessPayload | null>(null);
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [venue, setVenue] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const venueOptions = useMemo(
    () => [
      { label: 'All venues', value: '' },
      ...uniqueValues(staff.map((member) => member.venue).filter(Boolean) as string[]).map((item) => ({ label: item, value: item }))
    ],
    [staff]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date });
      if (venue) params.set('venue', venue);
      const data = await api<ReadinessPayload>(`/api/checklists/today-readiness?${params.toString()}`);
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load venue readiness.');
    } finally {
      setLoading(false);
    }
  }, [date, venue]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Auto-refresh once every two minutes — readiness changes as items are
    // ticked off, but we don't need second-by-second polling.
    const id = setInterval(() => { void load(); }, 120_000);
    return () => clearInterval(id);
  }, [load]);

  const openingRows = payload?.rows.filter((row) => row.kind === 'opening') ?? [];
  const closingRows = payload?.rows.filter((row) => row.kind === 'closing') ?? [];
  const serviceRows = payload?.rows.filter((row) => row.kind === 'service') ?? [];

  function renderGroup(title: string, subtitle: string, rows: ReadinessRow[], rollup: ReadinessRow['status'] | undefined) {
    return (
      <Card>
        <div className="readiness-group-head">
          <div>
            <span className="readiness-eyebrow">{title}</span>
            <p className="readiness-subtitle">{subtitle}</p>
          </div>
          {rollup ? (
            <span className={`readiness-rollup is-${rollup.toLowerCase()}`}>
              <span className="readiness-rollup-dot" aria-hidden="true" />
              {readinessLabel(rollup)}
            </span>
          ) : null}
        </div>
        {rows.length ? (
          <ul className="readiness-list">
            {rows.map((row) => (
              <li key={row.templateId} className={`readiness-row is-${row.status.toLowerCase()}`}>
                <span className="readiness-row-dot" aria-hidden="true" />
                <span className="readiness-row-text">
                  <strong>{row.templateName}</strong>
                  <span className="subtle">
                    {row.area || 'Whole venue'}
                    {' · '}
                    {row.itemsPassed}/{row.itemsTotal} done
                    {row.itemsFailed > 0 ? ` · ${row.itemsFailed} failed` : ''}
                    {row.performedBy ? ` · ${row.performedBy}` : ''}
                    {row.updatedAt ? ` · updated ${new Date(row.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}
                  </span>
                </span>
                <span className="readiness-row-status">
                  <Badge tone={readinessTone(row.status)}>{readinessLabel(row.status)}</Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      // Compliance app hosts the checklist runs. Deep-link if we have a run id,
                      // otherwise drop the manager into the checklists landing for that template.
                      const base = 'https://alma-compliance.web.app';
                      window.location.href = row.runId ? `${base}/checklists/runs/${row.runId}` : `${base}/checklists`;
                    }}
                  >
                    Open
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="subtle">No {title.toLowerCase()} checklists scheduled for today.</p>
        )}
      </Card>
    );
  }

  return (
    <div className="page-stack readiness-page">
      <PageHeader
        eyebrow="Venue readiness"
        title="Are we ready to open / close?"
        description="Today's checklists at a glance. Green = done, amber = in progress, red = failed item, grey = not started."
      />

      <Card>
        <div className="daily-brief-controls">
          <Input label="Date" type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} />
          <Select label="Venue" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} options={venueOptions} />
          <Button type="button" variant="secondary" onClick={() => { void load(); }} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </Card>

      {error ? <Card><p className="comms-error">{error}</p></Card> : null}

      {payload ? (
        <div className="readiness-banners">
          <div className={`readiness-banner is-${payload.overall.opening.toLowerCase()}`}>
            <span className="readiness-banner-tag">Opening</span>
            <span className="readiness-banner-label">{readinessLabel(payload.overall.opening)}</span>
          </div>
          <div className={`readiness-banner is-${payload.overall.closing.toLowerCase()}`}>
            <span className="readiness-banner-tag">Closing</span>
            <span className="readiness-banner-label">{readinessLabel(payload.overall.closing)}</span>
          </div>
          <div className={`readiness-banner is-${payload.overall.overall.toLowerCase()}`}>
            <span className="readiness-banner-tag">Overall</span>
            <span className="readiness-banner-label">{readinessLabel(payload.overall.overall)}</span>
          </div>
        </div>
      ) : null}

      {renderGroup('Opening', 'Get-ready checks. Aim for green before service starts.', openingRows, payload?.overall.opening)}
      {renderGroup('Closing', 'End-of-day checks. Aim for green before lockup.', closingRows, payload?.overall.closing)}
      {serviceRows.length ? renderGroup('During service', 'Mid-service checks like temperature logs and bar walks.', serviceRows, undefined) : null}
    </div>
  );
}
