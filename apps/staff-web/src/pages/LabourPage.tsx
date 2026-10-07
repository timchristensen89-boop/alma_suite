// Labour vs takings: the rostered week priced against what the venues
// actually took, per venue and for the group, split kitchen / FOH /
// management. Every figure on this page comes from one API payload built
// by apps/api/src/lib/labour-week.ts; the "Show the rows" drill-down under
// each venue lists the shifts and the sales rows that made the number, so
// a figure can be audited here without a database.

import { Fragment, useCallback, useEffect, useState } from 'react';
import type { LabourFigures, LabourWeekPayload, LabourWeekVenue, RosterDepartment } from '@alma/shared';
import { Badge, Button, Card, PageHeader, Spinner, StatCard } from '@alma/ui';
import { api } from '../lib/api';
import { labourMondayOf, labourMoney } from './shared';

const LABOUR_TYPE_LABEL: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CASUAL: 'Casual'
};

const DEPARTMENT_LABEL: Record<RosterDepartment, string> = {
  KITCHEN: 'Kitchen (BOH)',
  FOH: 'FOH',
  MANAGEMENT: 'Management',
  UNCLASSIFIED: 'Unclassified'
};

const hours = (value: number) => `${Math.round(value * 10) / 10}h`;
const pctText = (value: number | null) => (value == null ? '—' : `${value.toFixed(1)}%`);
const pctTone = (pct: number | null, target: number | null) => {
  if (pct == null) return '';
  const t = target ?? 32;
  return pct > t + 10 ? 'is-danger' : pct > t ? 'is-warning' : 'is-good';
};
const money = (cents: number | null | undefined) => (cents == null ? '—' : labourMoney(cents));
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric' });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' });

export function LabourPage() {
  const [weekStart, setWeekStart] = useState(() => labourMondayOf());
  const [data, setData] = useState<LabourWeekPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [openVenue, setOpenVenue] = useState<string | null>(null);

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

  // Week labels are calendar dates (YYYY-MM-DD from the API); the Date here
  // is only for formatting and never decides which week is shown.
  const shiftWeek = (current: string, weeks: number) => {
    const d = new Date(`${current}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + weeks * 7);
    return d.toISOString().slice(0, 10);
  };
  const weekStartLabel = new Date(`${weekStart}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  const weekEndLabel = new Date(`${shiftWeek(weekStart, 1)}T12:00:00`);
  weekEndLabel.setDate(weekEndLabel.getDate() - 1);

  const group = data?.group ?? null;
  const groupTarget = group?.target?.configured ? group.target : null;

  const departmentCells = (figures: LabourFigures, salesCents: number | null) =>
    (['KITCHEN', 'FOH', 'MANAGEMENT'] as RosterDepartment[]).map((dept) => {
      const d = figures.byDepartment[dept];
      return (
        <td key={dept} className="labour-deptcell">
          <strong>{money(d.costCents)}</strong>
          <span>{hours(d.paidHours)} paid{d.uncostedHours > 0 ? ` · ${hours(d.uncostedHours)} uncosted` : ''}</span>
          <em>{salesCents && salesCents > 0 ? pctText(d.labourPct) : '—'}</em>
        </td>
      );
    });

  return (
    <div className="labour-page">
      <PageHeader
        eyebrow="Staff · Labour"
        title="Labour vs takings"
        description="The rostered week priced against what the venues actually took (ex GST). Hours are shown two ways: rostered span (start to end, as on the roster) and paid hours (span minus unpaid breaks). Every dollar is on paid hours at each person's costing rate including super. Kitchen, FOH and management are split from the shift's area and role."
      />
      <div className="labour-weeknav">
        <Button type="button" size="sm" variant="secondary" onClick={() => setWeekStart((current) => shiftWeek(current, -1))}>
          ‹ Previous
        </Button>
        <strong>
          {weekStartLabel} – {weekEndLabel.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
        </strong>
        <Button type="button" size="sm" variant="secondary" onClick={() => setWeekStart((current) => shiftWeek(current, 1))}>
          Next ›
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setWeekStart(labourMondayOf())}>
          This week
        </Button>
        <span className="subtle">Monday to Sunday, Sydney time</span>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
      {loading && !data ? <Spinner label="Pricing the week…" /> : null}

      {data && group ? (
        <>
          {data.incomplete.flag ? (
            <div className="labour-banner is-danger">
              <strong>Incomplete — the labour figures below understate the week.</strong>
              {data.incomplete.uncostedHours > 0 ? (
                <span>
                  {hours(data.incomplete.uncostedHours)} rostered with no costing rate on file:{' '}
                  {data.incomplete.uncostedPeople.map((p) => `${p.name} (${hours(p.paidHours)})`).join(', ')}. These hours are counted but not costed, so every % that includes them is too low. Set their pay profile.
                </span>
              ) : null}
              {data.incomplete.unplacedVenueLabels.length > 0 ? (
                <span>Shifts under a label that is not a venue: {data.incomplete.unplacedVenueLabels.join(', ')}. They are in the group total and in no venue.</span>
              ) : null}
            </div>
          ) : null}
          {data.incomplete.unrosteredSalaried.length > 0 ? (
            <div className="labour-banner is-info">
              <span>
                Not in this roster-based figure: salaried staff with no shift this week —{' '}
                {data.incomplete.unrosteredSalaried.map((p) => `${p.name} (${money(p.weeklyFixedCostCents)}/wk)`).join(', ')}.
              </span>
            </div>
          ) : null}

          <div className="stats-grid">
            <StatCard
              label="Actual takings (ex GST)"
              value={labourMoney(group.salesCents)}
              hint={`${group.salesDays} venue-day${group.salesDays === 1 ? '' : 's'} with a figure · actual, not forecast`}
              loading={loading}
            />
            <StatCard label="Rostered span" value={hours(group.spanHours)} hint={`${hours(group.paidHours)} paid after breaks${group.openHours > 0 ? ` · ${hours(group.openHours)} unfilled` : ''}`} loading={loading} />
            <StatCard
              label="Labour cost (roster est.)"
              value={labourMoney(group.costCents)}
              hint={group.uncostedHours > 0 ? `${hours(group.uncostedHours)} not costed — see above` : `incl. ${data.methodology.superRatePct}% super · OT premium ${labourMoney(data.totals.overtimeCostCents)}`}
              tone={group.uncostedHours > 0 ? 'warning' : 'neutral'}
              loading={loading}
            />
            <StatCard
              label="Total labour %"
              value={pctText(group.labourPct)}
              hint={
                groupTarget
                  ? `target ${groupTarget.wagePct}% · ${groupTarget.variancePts == null ? '' : `${groupTarget.variancePts > 0 ? '+' : ''}${groupTarget.variancePts.toFixed(1)} pts`}`
                  : 'of actual takings · no target configured in Settings › Venues'
              }
              tone={group.labourPct == null ? 'neutral' : groupTarget && group.labourPct > groupTarget.wagePct ? 'warning' : 'neutral'}
              loading={loading}
            />
            <StatCard label="Kitchen labour %" value={pctText(group.byDepartment.KITCHEN.labourPct)} hint={`${labourMoney(group.byDepartment.KITCHEN.costCents)} · ${hours(group.byDepartment.KITCHEN.paidHours)} paid`} loading={loading} />
            <StatCard label="FOH labour %" value={pctText(group.byDepartment.FOH.labourPct)} hint={`${labourMoney(group.byDepartment.FOH.costCents)} · ${hours(group.byDepartment.FOH.paidHours)} paid`} loading={loading} />
          </div>

          <Card title="By venue" subtitle="Group = Avalon + St Alma in dollars; the group % is group dollars over group takings, never an average of the venue percentages. Each department % is that department's cost over the same takings.">
            <div className="labour-table-wrap">
              <table className="labour-table">
                <thead>
                  <tr>
                    <th>Venue</th>
                    <th>Actual takings</th>
                    <th>Span h</th>
                    <th>Paid h</th>
                    <th>Kitchen</th>
                    <th>FOH</th>
                    <th>Management</th>
                    <th>Total labour</th>
                    <th>Total %</th>
                    <th>Target</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.venues.map((venue) => (
                    <Fragment key={venue.venue}>
                      <tr className={venue.venueStatus !== 'configured' ? 'is-ot' : ''}>
                        <td>
                          <strong>{venue.venue}</strong>
                          {venue.venueStatus !== 'configured' ? <Badge tone="danger">not a venue</Badge> : null}
                          {venue.byDepartment.UNCLASSIFIED.paidHours > 0 ? <span className="subtle"> · {hours(venue.byDepartment.UNCLASSIFIED.paidHours)} unclassified</span> : null}
                        </td>
                        <td>
                          <strong>{labourMoney(venue.salesCents)}</strong>
                          <span className="subtle"> · {venue.salesDays}/7 days</span>
                        </td>
                        <td>{hours(venue.spanHours)}{venue.openHours > 0 ? <span className="subtle"> +{hours(venue.openHours)} open</span> : null}</td>
                        <td>{hours(venue.paidHours)}{venue.uncostedHours > 0 ? <span className="labour-ot"> ({hours(venue.uncostedHours)} uncosted)</span> : null}</td>
                        {departmentCells(venue, venue.salesCents)}
                        <td><strong>{labourMoney(venue.costCents)}</strong></td>
                        <td className={`labour-pct ${pctTone(venue.labourPct, venue.target?.configured ? venue.target.wagePct : null)}`}>
                          <strong>{pctText(venue.labourPct)}</strong>
                        </td>
                        <td>
                          {venue.target?.configured
                            ? `${venue.target.wagePct}% · ${venue.target.variancePts == null ? '—' : `${venue.target.variancePts > 0 ? '+' : ''}${venue.target.variancePts.toFixed(1)} pts`}`
                            : '—'}
                        </td>
                        <td>
                          <Button type="button" size="sm" variant="secondary" onClick={() => setOpenVenue((current) => (current === venue.venue ? null : venue.venue))}>
                            {openVenue === venue.venue ? 'Hide rows' : 'Show rows'}
                          </Button>
                        </td>
                      </tr>
                      {openVenue === venue.venue ? (
                        <tr>
                          <td colSpan={11} className="labour-drilldown">
                            <VenueDrilldown venue={venue} data={data} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                  <tr className="labour-total-row">
                    <td><strong>Group</strong></td>
                    <td><strong>{labourMoney(group.salesCents)}</strong></td>
                    <td>{hours(group.spanHours)}</td>
                    <td>{hours(group.paidHours)}</td>
                    {departmentCells(group, group.salesCents)}
                    <td><strong>{labourMoney(group.costCents)}</strong></td>
                    <td className={`labour-pct ${pctTone(group.labourPct, groupTarget?.wagePct ?? null)}`}><strong>{pctText(group.labourPct)}</strong></td>
                    <td>{groupTarget ? `${groupTarget.wagePct}% (${group.target?.source === 'group_average' ? 'venue avg' : 'venue'})` : '—'}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="People" subtitle="Rostered against contract. Span = roster start to end; paid = after unpaid breaks. Headroom = hours a salary already covers (contract → 45). Overtime = past 45 paid hours, priced at the costing engine's OT rate. A salaried week costs the full salary whatever the hours.">
            <div className="labour-table-wrap">
              <table className="labour-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Type</th>
                    <th>Venues</th>
                    <th>Contract h</th>
                    <th>Span</th>
                    <th>Paid</th>
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
                      <tr key={person.staffProfileId} className={person.overtimeHours > 0 || !person.rateKnown ? 'is-ot' : ''}>
                        <td>
                          {person.name}
                          {person.rateKnown ? null : <Badge tone="danger">no rate</Badge>}
                        </td>
                        <td>{LABOUR_TYPE_LABEL[person.employmentType] ?? person.employmentType}{person.salaried ? ' · salary' : ''}</td>
                        <td>{person.venues.map((v) => `${v.venue} ${hours(v.paidHours)}`).join(' · ')}</td>
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
                        <td>{hours(person.spanHours)}</td>
                        <td><strong>{hours(person.paidHours)}</strong></td>
                        <td>{person.headroomHours > 0 ? `${hours(person.headroomHours)} free` : person.overAgreedHours > 0 ? `+${hours(person.overAgreedHours)} over agreed` : '—'}</td>
                        <td className={person.overtimeHours > 0 ? 'labour-ot' : ''}>{person.overtimeHours > 0 ? `+${hours(person.overtimeHours)}` : '—'}</td>
                        <td className={(person.overtimeCostCents ?? 0) > 0 ? 'labour-ot' : ''}>{(person.overtimeCostCents ?? 0) > 0 ? labourMoney(person.overtimeCostCents!) : '—'}</td>
                        <td>{person.estWeekCostCents == null ? <span className="labour-ot">not costed</span> : labourMoney(person.estWeekCostCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Day by day" subtitle="Each venue-day's rostered cost against that day's actual takings. A day with no takings recorded shows hours only — it is not zero sales. Public holidays are flagged; no penalty rate is applied to them.">
            <div className="labour-table-wrap">
              <table className="labour-table">
                <thead>
                  <tr>
                    <th>Venue</th>
                    {data.dayKeys.map((date) => (
                      <th key={date}>{dayLabel(date)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.venues.map((venue) => (
                    <tr key={venue.venue}>
                      <td><strong>{venue.venue}</strong></td>
                      {venue.days.map((cell) => {
                        if (cell.paidHours === 0 && cell.openHours === 0 && cell.salesCents == null) return <td key={cell.date}>—</td>;
                        return (
                          <td key={cell.date} className={`labour-daycell ${pctTone(cell.labourPct, venue.target?.configured ? venue.target.wagePct : null)}`}>
                            <strong>{cell.salesCents == null ? 'no takings yet' : labourMoney(cell.salesCents)}</strong>
                            <span>{hours(cell.spanHours)} span · {hours(cell.paidHours)} paid</span>
                            <span>{labourMoney(cell.costCents)} · K {hours(cell.byDepartment.KITCHEN.paidHours)} / F {hours(cell.byDepartment.FOH.paidHours)}</span>
                            {cell.labourPct != null ? <em>{cell.labourPct.toFixed(0)}% · K {pctText(cell.byDepartment.KITCHEN.labourPct)}</em> : null}
                            {cell.openHours > 0 ? <small>{hours(cell.openHours)} unfilled</small> : null}
                            {cell.uncostedHours > 0 ? <small>{hours(cell.uncostedHours)} uncosted</small> : null}
                            {cell.publicHoliday ? <small className="labour-holiday">{cell.publicHoliday}</small> : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="labour-total-row">
                    <td><strong>Group</strong></td>
                    {group.byDay.map((cell) => (
                      <td key={cell.date} className={`labour-daycell ${pctTone(cell.labourPct, groupTarget?.wagePct ?? null)}`}>
                        <strong>{cell.salesCents == null ? '—' : labourMoney(cell.salesCents)}</strong>
                        <span>{hours(cell.paidHours)} paid · {labourMoney(cell.costCents)}</span>
                        {cell.labourPct != null ? <em>{cell.labourPct.toFixed(0)}%</em> : null}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="How these numbers are made" subtitle="Stated so nobody reads a flat-rate roster estimate as payroll.">
            <ul className="labour-method">
              <li><strong>Takings:</strong> {data.methodology.sales}</li>
              <li><strong>Hours:</strong> {data.methodology.hours}</li>
              <li><strong>Cost:</strong> {data.methodology.cost}</li>
              <li>
                <strong>Not in this figure:</strong>
                <ul>
                  {data.methodology.notCosted.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </li>
            </ul>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function VenueDrilldown({ venue, data }: { venue: LabourWeekVenue; data: LabourWeekPayload }) {
  const shifts = data.reconciliation.shifts.filter((row) => row.venue === venue.venue);
  const sales = data.reconciliation.sales.filter((row) => row.venue === venue.venue);
  const ratesVisible = data.reconciliation.ratesVisible;
  return (
    <div className="labour-drilldown-inner">
      <h4>Shifts that made {venue.venue}'s labour ({shifts.length})</h4>
      <div className="labour-table-wrap">
        <table className="labour-table labour-table-compact">
          <thead>
            <tr>
              <th>Date</th>
              <th>Person</th>
              <th>Dept</th>
              <th>Area / role</th>
              <th>Start</th>
              <th>End</th>
              <th>Span</th>
              <th>Break</th>
              <th>Paid</th>
              {ratesVisible ? <th>Rate/h</th> : null}
              {ratesVisible ? <th>Cost</th> : null}
              <th>Venue from</th>
              <th>Shift</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((row) => (
              <tr key={row.shiftId} className={row.department === 'UNCLASSIFIED' || row.venueSource !== 'explicit' ? 'is-ot' : ''}>
                <td>{dayLabel(row.date)}</td>
                <td>{row.name}</td>
                <td title={row.departmentBasis}>{DEPARTMENT_LABEL[row.department]}</td>
                <td>{[row.area, row.roleTitle].filter(Boolean).join(' / ') || '—'}</td>
                <td>{timeLabel(row.startsAt)}</td>
                <td>{timeLabel(row.endsAt)}</td>
                <td>{hours(row.spanHours)}</td>
                <td>{row.unpaidBreakHours > 0 ? hours(row.unpaidBreakHours) : '—'}</td>
                <td><strong>{hours(row.paidHours)}</strong></td>
                {ratesVisible ? <td title={row.rateSource}>{row.rateCents == null ? <span className="labour-ot">none</span> : `$${(row.rateCents / 100).toFixed(2)}`}</td> : null}
                {ratesVisible ? <td title={row.costBasis}>{row.costCents == null ? <span className="labour-ot">not costed</span> : labourMoney(row.costCents)}</td> : null}
                <td>{row.venueSource === 'explicit' ? 'shift' : row.venueSource === 'profile' ? 'home venue (shift had none)' : row.venueSource}</td>
                <td className="subtle">{row.shiftId.slice(0, 8)}</td>
              </tr>
            ))}
            {shifts.length === 0 ? (
              <tr>
                <td colSpan={ratesVisible ? 13 : 11}>No published shifts at this venue this week.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {!ratesVisible ? <p className="subtle">Per-shift rates and costs are shown to admins only; the totals above include them.</p> : null}
      <h4>Takings rows for {venue.venue} ({sales.length})</h4>
      <div className="labour-table-wrap">
        <table className="labour-table labour-table-compact">
          <thead>
            <tr>
              <th>Date</th>
              <th>Source</th>
              <th>Stored figure (ex GST)</th>
              <th>Used</th>
              <th>Label on row</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((row) => (
              <tr key={row.id} className={row.used ? '' : 'subtle'}>
                <td>{dayLabel(row.date)}</td>
                <td>{row.source}</td>
                <td>{labourMoney(row.salesCents)}</td>
                <td>{row.used ? 'yes' : 'no — a larger feed figure for the same day was used'}</td>
                <td>{row.venueLabel}</td>
                <td>{row.notes ?? '—'}</td>
              </tr>
            ))}
            {sales.length === 0 ? (
              <tr>
                <td colSpan={6}>No takings recorded for this venue this week.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
