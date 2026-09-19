// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, PageHeader, Spinner, StatCard } from '@alma/ui';
import { api } from '../lib/api';
import { type LabourWeekPayload, labourMondayOf, labourMoney } from './shared';

const LABOUR_TYPE_LABEL: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CASUAL: 'Casual'
};

export function LabourPage() {
  const [weekStart, setWeekStart] = useState(() => labourMondayOf());
  const [data, setData] = useState<LabourWeekPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<LabourWeekPayload>(`/api/staff/labour-week?weekStart=${weekStart}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the labour week.');
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveContract(staffProfileId: string) {
    const raw = drafts[staffProfileId];
    if (raw === undefined) return;
    setSavingId(staffProfileId);
    try {
      await api(`/api/staff/${staffProfileId}/contracted-hours`, {
        method: 'PUT',
        body: JSON.stringify({ contractedWeeklyHours: raw.trim() === '' ? null : Number(raw) })
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[staffProfileId];
        return next;
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save contracted hours.');
    } finally {
      setSavingId(null);
    }
  }

  const weekEndLabel = (() => {
    const end = new Date(`${weekStart}T12:00:00`);
    end.setDate(end.getDate() + 6);
    return end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  })();
  const weekStartLabel = new Date(`${weekStart}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const labourPct =
    data && data.totals.salesCents > 0 ? (data.totals.estCostCents / data.totals.salesCents) * 100 : null;
  const pctTone = (pct: number | null) => (pct == null ? '' : pct > 45 ? 'is-danger' : pct > 32 ? 'is-warning' : 'is-good');

  return (
    <div className="labour-page">
      <PageHeader
        eyebrow="Staff · Labour"
        title="Labour vs takings"
        description="The rostered week priced against what the venues actually took. Contract hours are editable in the table — headroom is what a salary already covers; overtime past 45 is real money."
      />
      <div className="labour-weeknav">
        <Button type="button" size="sm" variant="secondary" onClick={() => setWeekStart((current) => {
          const d = new Date(`${current}T12:00:00`);
          d.setDate(d.getDate() - 7);
          return d.toISOString().slice(0, 10);
        })}>
          ‹ Previous
        </Button>
        <strong>{weekStartLabel} – {weekEndLabel}</strong>
        <Button type="button" size="sm" variant="secondary" onClick={() => setWeekStart((current) => {
          const d = new Date(`${current}T12:00:00`);
          d.setDate(d.getDate() + 7);
          return d.toISOString().slice(0, 10);
        })}>
          Next ›
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setWeekStart(labourMondayOf())}>This week</Button>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading && !data ? <Spinner label="Pricing the week…" /> : null}

      {data ? (
        <>
          <div className="stats-grid">
            <StatCard label="Actual takings" value={labourMoney(data.totals.salesCents)} hint="sum of best-known daily totals" loading={loading} />
            <StatCard label="Rostered labour (est)" value={labourMoney(data.totals.estCostCents)} hint="published shifts at costing rates" loading={loading} />
            <StatCard label="Labour %" value={labourPct == null ? '—' : `${labourPct.toFixed(1)}%`} hint="of actual takings, not forecast" loading={loading} />
            <StatCard label="Overtime premium" value={labourMoney(data.totals.overtimeCostCents)} hint="the extra cost of hours past 45" loading={loading} />
          </div>

          <Card title="People" subtitle="Rostered against contract. Headroom = hours a salary already covers (contract → 45). Overtime = past 45, priced at the costing engine's OT rate.">
            <div className="labour-table-wrap">
              <table className="labour-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Type</th>
                    <th>Contract h</th>
                    <th>Rostered</th>
                    <th>Headroom</th>
                    <th>Overtime</th>
                    <th>OT cost</th>
                    <th>Week est.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((person) => {
                    const draft = drafts[person.staffProfileId];
                    const contractValue = draft ?? (person.contractedWeeklyHours == null ? '' : String(person.contractedWeeklyHours));
                    return (
                      <tr key={person.staffProfileId} className={person.overtimeHours > 0 ? 'is-ot' : ''}>
                        <td>{person.name}{person.rateKnown ? '' : ' *'}</td>
                        <td>{LABOUR_TYPE_LABEL[person.employmentType] ?? person.employmentType}</td>
                        <td>
                          <input
                            className="labour-contract-input"
                            inputMode="numeric"
                            placeholder={person.employmentType === 'CASUAL' ? '—' : 'h'}
                            value={contractValue}
                            disabled={savingId === person.staffProfileId}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setDrafts((current) => ({ ...current, [person.staffProfileId]: value }));
                            }}
                            onBlur={() => void saveContract(person.staffProfileId)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') event.currentTarget.blur();
                            }}
                          />
                        </td>
                        <td><strong>{person.rosteredHours}h</strong></td>
                        <td>{person.headroomHours > 0 ? `${person.headroomHours}h free` : person.overAgreedHours > 0 ? `+${person.overAgreedHours}h over agreed` : '—'}</td>
                        <td className={person.overtimeHours > 0 ? 'labour-ot' : ''}>{person.overtimeHours > 0 ? `+${person.overtimeHours}h` : '—'}</td>
                        <td className={person.overtimeCostCents > 0 ? 'labour-ot' : ''}>{person.overtimeCostCents > 0 ? labourMoney(person.overtimeCostCents) : '—'}</td>
                        <td>{labourMoney(person.estWeekCostCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data.people.some((person) => !person.rateKnown) ? (
              <p className="subtle">* no costing rate on file — hours counted, dollars understated. Set their pay profile.</p>
            ) : null}
          </Card>

          <Card title="Day by day" subtitle="Estimated rostered cost against each day's actual takings. Green under 32%, amber to 45%, red past it. Days with no takings yet show hours only.">
            <div className="labour-table-wrap">
              <table className="labour-table">
                <thead>
                  <tr>
                    <th>Venue</th>
                    {data.days.map((day) => (
                      <th key={day.date}>{new Date(`${day.date}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric' })}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.venues.map((venue) => (
                    <tr key={venue}>
                      <td><strong>{venue}</strong></td>
                      {data.days.map((day) => {
                        const cell = day.byVenue.find((entry) => entry.venue === venue);
                        if (!cell || (cell.rosteredHours === 0 && cell.salesCents == null)) return <td key={day.date}>—</td>;
                        return (
                          <td key={day.date} className={`labour-daycell ${pctTone(cell.labourPct)}`}>
                            <strong>{cell.salesCents == null ? 'no takings yet' : labourMoney(cell.salesCents)}</strong>
                            <span>{cell.rosteredHours}h · {labourMoney(cell.estCostCents)}</span>
                            {cell.labourPct != null ? <em>{cell.labourPct.toFixed(0)}%</em> : null}
                            {cell.openHours > 0 ? <small>{cell.openHours}h unfilled</small> : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
