// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { StaffProfile, StaffTipsSummary } from '@alma/shared';
import {
  ActionFeedback,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatCard,
  Textarea
} from '@alma/ui';
import { api } from '../lib/api';
import { startOfWeek, addDays, toDateInput, formatRange, roundHours, uniqueValues, formatCents } from '../lib/datetime';
import {
  staffForPicker,
  ShowTerminatedStaffToggle,
  staffInitials,
  weekDays,
  areaStyle,
  downloadTextFile,
  parseMoneyCents
} from './shared';

export function TipsPage({ staff }: { staff: StaffProfile[] }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [venue, setVenue] = useState(staff.find((member) => member.venue)?.venue ?? 'Alma Avalon');
  const [serviceDate, setServiceDate] = useState(() => toDateInput(new Date()));
  const [cashAmount, setCashAmount] = useState('');
  const [cashNotes, setCashNotes] = useState('');
  const [payoutNotes, setPayoutNotes] = useState('');
  const [cardImportSource, setCardImportSource] = useState('control');
  const [cardImportText, setCardImportText] = useState('');
  const [manualStaffId, setManualStaffId] = useState('');
  const [showTerminatedStaff, setShowTerminatedStaff] = useState(false);
  const [manualHours, setManualHours] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [adjustments, setAdjustments] = useState<Record<string, { adjustment: string; excluded: boolean; paidInCash: boolean; notes: string }>>({});
  const [summary, setSummary] = useState<StaffTipsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  // "Pay from" funding accounts (Settings → Tip payments). Empty = only the
  // base business account exists, so no selector is shown.
  const [abaAccounts, setAbaAccounts] = useState<Array<{ key: string; label: string; maskedAccount: string }>>([]);
  const [abaAccountKey, setAbaAccountKey] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        setAbaAccounts(await api<Array<{ key: string; label: string; maskedAccount: string }>>('/api/staff/tips/aba-accounts'));
      } catch {
        /* manager may lack settings access — selector just stays hidden */
      }
    })();
  }, []);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const venueOptions = useMemo(
    () => uniqueValues(staff.map((member) => member.venue).filter(Boolean) as string[]).map((value) => ({ label: value, value })),
    [staff]
  );

  const loadTips = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const query = new URLSearchParams({
        start: weekStart.toISOString(),
        end: weekEnd.toISOString(),
        venue
      });
      setSummary(await api<StaffTipsSummary>(`/api/staff/tips?${query.toString()}`));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load tips.');
    } finally {
      setLoading(false);
    }
  }, [venue, weekEnd, weekStart]);

  useEffect(() => {
    if (!venue && venueOptions[0]) setVenue(venueOptions[0].value);
  }, [venue, venueOptions]);

  useEffect(() => {
    if (venue) void loadTips();
  }, [loadTips, venue]);

  useEffect(() => {
    setAdjustments({});
  }, [venue, weekStart]);

  const adjustmentPayload = useMemo(() => Object.entries(adjustments)
    .map(([staffProfileId, adjustment]) => ({
      staffProfileId,
      adjustmentCents: Math.round((Number(adjustment.adjustment) || 0) * 100),
      excluded: adjustment.excluded,
      paidInCash: adjustment.paidInCash,
      notes: adjustment.notes
    }))
    .filter((adjustment) => adjustment.adjustmentCents !== 0 || adjustment.excluded || adjustment.paidInCash || adjustment.notes.trim().length > 0), [adjustments]);

  // Excluding someone hands their share back to the pool: their hours leave
  // the divisor and everyone left is re-cut over the same pool, so the final
  // payout still balances (variance $0) instead of stranding the excluded
  // share. Paid in cash changes nothing here — their amount stands, only the
  // bank file skips them. Mirrors the server-side applyTipAdjustments exactly
  // (same pro-rata + last-row-remainder rounding).
  const reviewedRows = useMemo(() => {
    const rows = summary?.entitlements ?? [];
    const excludedIds = new Set(
      rows.filter((row) => adjustments[row.staffProfileId]?.excluded).map((row) => row.staffProfileId)
    );
    const poolCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
    const activeRows = rows.filter((row) => !excludedIds.has(row.staffProfileId));
    const activeHours = activeRows.reduce((sum, row) => sum + row.approvedHours, 0);
    const redistributedBase = new Map<string, number>();
    let allocated = 0;
    activeRows.forEach((row, index) => {
      const isLast = index === activeRows.length - 1;
      const cents = activeHours > 0
        ? isLast
          ? poolCents - allocated
          : Math.round((row.approvedHours / activeHours) * poolCents)
        : 0;
      allocated += cents;
      redistributedBase.set(row.staffProfileId, cents);
    });
    return rows.map((row) => {
      const adjustment = adjustments[row.staffProfileId];
      const excluded = excludedIds.has(row.staffProfileId);
      const baseCents = excluded ? row.amountCents : redistributedBase.get(row.staffProfileId) ?? row.amountCents;
      const adjustmentCents = excluded ? -baseCents : Math.round((Number(adjustment?.adjustment) || 0) * 100);
      return {
        ...row,
        amountCents: baseCents,
        adjustmentCents,
        finalAmountCents: Math.max(0, baseCents + adjustmentCents),
        excluded,
        paidInCash: !excluded && Boolean(adjustment?.paidInCash),
        reviewNotes: adjustment?.notes ?? ''
      };
    });
  }, [adjustments, summary?.entitlements]);

  const totalPayoutCents = reviewedRows.reduce((sum, row) => sum + row.finalAmountCents, 0);
  const payoutVarianceCents = totalPayoutCents - (summary?.tipPoolCents ?? 0);
  const lockedRows = summary?.paidEntitlements ?? [];
  const hasPaidRun = lockedRows.length > 0;

  function updateTipAdjustment(staffProfileId: string, patch: Partial<{ adjustment: string; excluded: boolean; paidInCash: boolean; notes: string }>) {
    setAdjustments((current) => ({
      ...current,
      [staffProfileId]: {
        adjustment: current[staffProfileId]?.adjustment ?? '',
        excluded: current[staffProfileId]?.excluded ?? false,
        paidInCash: current[staffProfileId]?.paidInCash ?? false,
        notes: current[staffProfileId]?.notes ?? '',
        ...patch
      }
    }));
  }

  async function saveCashTips() {
    setMessageTarget('cash');
    if (!venue) {
      setMessage('Choose a venue before adding cash tips.');
      return;
    }
    const amountCents = Math.round((Number(cashAmount) || 0) * 100);
    setSaving(true);
    setMessage(null);
    try {
      await api('/api/staff/tips/cash-entry', {
        method: 'POST',
        body: JSON.stringify({ venue, serviceDate: `${serviceDate}T00:00:00`, amountCents, notes: cashNotes })
      });
      setMessage(amountCents > 0 ? `Saved ${formatCents(amountCents)} cash tips.` : 'Cleared cash tips for that date.');
      setCashAmount('');
      setCashNotes('');
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save cash tips.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteCashEntry(id: string) {
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/tips/cash/${id}`, { method: 'DELETE' });
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete cash entry.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteCardEntry(id: string) {
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/tips/card/${id}`, { method: 'DELETE' });
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete card entry.');
    } finally {
      setSaving(false);
    }
  }

  async function bulkDeleteEntries(type: 'cash' | 'card' | 'all') {
    if (!venue) return;
    const label = type === 'all' ? 'all cash and card tip entries' : `all ${type} tip entries`;
    if (!window.confirm(`Delete ${label} for ${venue} this week? This cannot be undone.`)) return;
    setBulkDeleting(true);
    setMessage(null);
    try {
      const result = await api<{ deletedCash: number; deletedCard: number }>('/api/staff/tips/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ venue, start: weekStart.toISOString(), end: weekEnd.toISOString(), type })
      });
      setMessage(`Deleted ${result.deletedCash + result.deletedCard} entries.`);
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete entries.');
    } finally {
      setBulkDeleting(false);
    }
  }

  async function saveManualHours() {
    setMessageTarget('manual');
    if (!venue || !manualStaffId || !manualHours) {
      setMessage('Choose venue, staff member, and hours.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api('/api/staff/tips/manual-hours', {
        method: 'POST',
        body: JSON.stringify({ staffProfileId: manualStaffId, venue, weekStart: weekStart.toISOString(), hours: Number(manualHours), notes: manualNotes })
      });
      setMessage('Manual hours entry saved.');
      setManualStaffId('');
      setManualHours('');
      setManualNotes('');
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save manual hours.');
    } finally {
      setSaving(false);
    }
  }

  async function importDeputyHours() {
    setSaving(true);
    setMessage(null);
    setMessageTarget('deputy-import');
    try {
      const result = await api<{ imported: number; timesheetRows: number; totalHours: number }>('/api/staff/tips/deputy-import', {
        method: 'POST',
        body: JSON.stringify({ start: weekStart.toISOString(), end: weekEnd.toISOString(), venue })
      });
      setMessage(
        result.imported
          ? `Imported Deputy hours for ${result.imported} staff (${result.totalHours}h from ${result.timesheetRows} timesheet rows). Adjust below if needed.`
          : 'No Deputy timesheets found for this week — run the Deputy sync (Admin → Integrations) first, then re-import.'
      );
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not import Deputy hours.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteManualHoursEntry(id: string) {
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/tips/manual-hours/${id}`, { method: 'DELETE' });
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete manual entry.');
    } finally {
      setSaving(false);
    }
  }

  async function importCardTips() {
    setMessageTarget('import');
    if (!venue) {
      setMessage('Choose a venue before importing card tips.');
      return;
    }
    const parsedRows = parseTipsImportRows(cardImportText, venue, cardImportSource);
    if (!parsedRows.length) {
      setMessage('Paste card tips rows with at least a date and amount column.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await api<{ imported: number; updated: number; count: number }>('/api/staff/tips/card-import', {
        method: 'POST',
        body: JSON.stringify({ rows: parsedRows })
      });
      setMessage(`Imported ${result.imported} card tip row${result.imported === 1 ? '' : 's'} and updated ${result.updated}.`);
      setCardImportText('');
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not import card tips.');
    } finally {
      setSaving(false);
    }
  }

  async function importSquareTips(targetVenue = venue) {
    setMessageTarget('square-import');
    if (!targetVenue) {
      setMessage('Choose a venue before importing Square tips.');
      return;
    }
    setVenue(targetVenue);
    setSaving(true);
    setMessage(null);
    try {
      const result = await api<{
        label: string;
        paymentsRead: number;
        tipRows: number;
        imported: number;
        updated: number;
        amountCents: number;
        warnings: string[];
      }>('/api/staff/tips/square-import', {
        method: 'POST',
        body: JSON.stringify({
          start: weekStart.toISOString(),
          end: weekEnd.toISOString(),
          venue: targetVenue
        })
      });
      const warning = result.warnings.length ? ` ${result.warnings[0]}` : '';
      setMessage(`${result.label}: imported ${result.imported}, updated ${result.updated}, ${formatCents(result.amountCents)} from ${result.tipRows} Square tip payment${result.tipRows === 1 ? '' : 's'}.${warning}`);
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not import Square tips.');
    } finally {
      setSaving(false);
    }
  }

  async function exportTips() {
    setMessageTarget('export');
    if (!venue) {
      setMessage('Choose a venue before exporting tips.');
      return;
    }
    if (!hasPaidRun) {
      setMessage('Approve and pay this tip run before exporting CSV.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await api<{ csv: string }>('/api/staff/tips/export/csv', {
        method: 'POST',
        body: JSON.stringify({ start: weekStart.toISOString(), end: weekEnd.toISOString(), venue, adjustments: adjustmentPayload })
      });
      downloadTextFile(`alma-tips-${venue}-${toDateInput(weekStart)}.csv`, result.csv);
      setMessage('Tips CSV exported.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not export tips.');
    } finally {
      setSaving(false);
    }
  }

  async function exportTipsAba() {
    setMessageTarget('aba');
    if (!venue) {
      setMessage('Choose a venue before exporting an ABA file.');
      return;
    }
    if (!hasPaidRun) {
      setMessage('Approve and pay this tip run before exporting an ABA file.');
      return;
    }
    if (abaAccounts.length > 0 && !abaAccountKey) {
      setMessage('Choose which bank account to pay from before exporting.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await api<{ aba: string; filename: string; count: number; totalCents: number }>('/api/staff/tips/export/aba', {
        method: 'POST',
        body: JSON.stringify({
          start: weekStart.toISOString(),
          end: weekEnd.toISOString(),
          venue,
          ...(abaAccountKey ? { accountKey: abaAccountKey } : {})
        })
      });
      downloadTextFile(result.filename || `alma-tips-${venue}-${toDateInput(weekStart)}.aba`, result.aba, 'text/plain');
      setMessage(`ABA exported for ${result.count} staff · ${formatCents(result.totalCents)}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not export ABA file.');
    } finally {
      setSaving(false);
    }
  }

  async function markPaid() {
    setMessageTarget('paid');
    if (!venue) {
      setMessage('Choose a venue before marking tips paid.');
      return;
    }
    if (payoutVarianceCents !== 0) {
      setMessage(`Final payout must balance to the tip pool before marking paid. Current variance is ${formatCents(payoutVarianceCents)}.`);
      return;
    }
    if (!window.confirm(`Mark ${formatCents(totalPayoutCents)} tips paid for ${venue}? This creates the approved tip run used by Reports payroll export.`)) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api('/api/staff/tips/mark-paid', {
        method: 'POST',
        body: JSON.stringify({ start: weekStart.toISOString(), end: weekEnd.toISOString(), venue, notes: payoutNotes, adjustments: adjustmentPayload })
      });
      setMessage('Tips approved and paid. You can now export ABA or CSV.');
      setPayoutNotes('');
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not mark tips paid.');
    } finally {
      setSaving(false);
    }
  }

  async function removeLockedRun() {
    const run = summary?.paidRuns?.[0];
    if (!run) return;
    setMessageTarget('paid');
    if (
      !window.confirm(
        `Remove the approved tip run for ${venue} (week of ${formatRange(weekStart, weekEnd)})?\n\n` +
          `This unlocks the week so you can review and re-approve it from corrected data. ` +
          `Reports will no longer use the old snapshot. This cannot be undone.`
      )
    ) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await api<{ removedLines: number }>(`/api/staff/tips/run/${run.id}`, { method: 'DELETE' });
      setMessage(`Approved tip run removed (${result.removedLines} staff). Review the week and re-approve when ready.`);
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not remove the approved tip run.');
    } finally {
      setSaving(false);
    }
  }

  function downloadTipsTemplate() {
    downloadTextFile(
      `alma-card-tips-template-${venue || 'venue'}-${toDateInput(weekStart)}.csv`,
      [
        'date,venue,tips,externalId,notes',
        `${toDateInput(weekStart)},${venue || 'Alma Avalon'},0,example-1,Square or Control import`
      ].join('\n')
    );
  }

  const staffOptions = useMemo(
    () => staffForPicker(staff, showTerminatedStaff, manualStaffId)
      .filter((member) => !member.venue || member.venue === venue || !venue)
      .map((member) => ({ value: member.id, label: `${member.firstName} ${member.lastName}${member.venue ? ` · ${member.venue}` : ''}` })),
    [staff, venue, showTerminatedStaff, manualStaffId]
  );

  return (
    <div className="page-stack tips-page">
      <PageHeader
        eyebrow="Payroll"
        title="Tips"
        description="Record tips, allocate across approved hours, and export a payout run."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => void loadTips()} disabled={loading}>Refresh</Button>
          </>
        }
      />

      {/* Tips week navigator — same editorial style as the roster board so
          the two pages feel like one tool. The venue picker lives below. */}
      <div className="alma-roster-header alma-roster-header--tight">
        <div className="alma-roster-header-titles">
          <span className="alma-roster-eyebrow">Staff · Tips</span>
          <div className="alma-roster-title-row">
            <span className="alma-roster-title">Week of</span>
            <span className="alma-roster-title is-italic">{formatRange(weekStart, addDays(weekEnd, -1))}</span>
            <div className="alma-roster-weeknav">
              <button
                type="button"
                className="alma-roster-weeknav-btn"
                aria-label="Previous week"
                onClick={() => setWeekStart(addDays(weekStart, -7))}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="15 6 9 12 15 18" />
                </svg>
              </button>
              <button
                type="button"
                className="alma-roster-weeknav-btn"
                aria-label="Next week"
                onClick={() => setWeekStart(addDays(weekStart, 7))}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
              <button
                type="button"
                className="alma-roster-weeknav-btn alma-roster-weeknav-btn--text"
                onClick={() => setWeekStart(startOfWeek(new Date()))}
              >
                This week
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Roster & pay Turn 2: hero stat row — the week's pool at a glance. */}
      <div className="tips-hero-row">
        <div className="tips-hero-card is-primary">
          <span className="tips-hero-label">Total pool</span>
          <span className="tips-hero-value">{loading ? '…' : formatCents(summary?.tipPoolCents ?? 0)}</span>
          <span className="tips-hero-sub">
            Cash + card · {summary?.tradingDays ?? 0} trading day{summary?.tradingDays === 1 ? '' : 's'}
          </span>
        </div>
        <div className="tips-hero-card">
          <span className="tips-hero-label">Card tips</span>
          <span className="tips-hero-value">
            {loading ? '…' : formatCents(Math.max(0, (summary?.tipPoolCents ?? 0) - (summary?.cashTipsCents ?? 0)))}
          </span>
          <span className="tips-hero-sub">
            {summary?.cardEntries.length ?? 0} imported entr{(summary?.cardEntries.length ?? 0) === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <div className="tips-hero-card">
          <span className="tips-hero-label">Cash tips</span>
          <span className="tips-hero-value">{loading ? '…' : formatCents(summary?.cashTipsCents ?? 0)}</span>
          <span className="tips-hero-sub">
            {summary?.cashEntries.length ?? 0} day{(summary?.cashEntries.length ?? 0) === 1 ? '' : 's'} entered
          </span>
        </div>
      </div>

      {/* Venue picker lives just below the week selector. Tips pool per venue,
          so this choice decides whose money is on screen — nothing on this page
          is ever a group total. */}
      <TipsSection title="Review settings" summary={venue || 'Choose venue'}>
        <Card padding="tight">
          <div className="tips-controls-row">
            <Select label="Venue" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} options={venueOptions} />
          </div>
          <p className="subtle" style={{ marginTop: 8, marginBottom: 0 }}>
            Each venue's tips are split between the people who worked that venue. Switch venues to review the other pool.
          </p>
        </Card>
      </TipsSection>

      {/* Summary stats */}
      <TipsSection title="Summary" summary={`${formatCents(summary?.tipPoolCents ?? 0)} to split · ${hasPaidRun ? 'approved' : 'waiting for review'}`}>
        <div className="stats-grid">
          <StatCard label="Tip pool" value={formatCents(summary?.tipPoolCents ?? 0)} hint={`Cash + card at ${venue || 'this venue'}`} loading={loading} />
          <StatCard label="Final payout" value={formatCents(totalPayoutCents)} hint={payoutVarianceCents === 0 ? 'Balances to pool' : `${formatCents(Math.abs(payoutVarianceCents))} ${payoutVarianceCents > 0 ? 'over' : 'under'}`} loading={loading} />
          <StatCard label="Approved hours" value={roundHours(summary?.approvedHours ?? 0)} hint="Used for allocation" loading={loading} />
          <StatCard label="Run status" value={hasPaidRun ? 'Locked' : 'Waiting'} hint={hasPaidRun ? 'Payroll export ready' : 'Approve at the bottom'} loading={loading} />
        </div>
      </TipsSection>

      {/* Hours with no venue are in nobody's pool. Say so loudly — the whole
          point of naming them is that someone is otherwise quietly unpaid. */}
      {summary?.unassigned?.length ? (
        <Card padding="tight">
          <p className="error-text" style={{ margin: 0 }}>
            {summary.unassigned.length === 1 ? '1 person has' : `${summary.unassigned.length} people have`} approved hours with no venue,
            so they are in no tip pool: {summary.unassigned.map((row) => `${row.name} (${roundHours(row.approvedHours)}h)`).join(', ')}.
            Set the venue on their timesheet or their staff profile, then refresh.
          </p>
        </Card>
      ) : null}

      {loading ? <Spinner label="Loading tips..." /> : null}
      {message && !messageTarget ? <p className={message.includes('Could') || message.includes('Choose') ? 'error-text' : 'subtle'}>{message}</p> : null}

      {/* Per-day breakdown */}
      {(summary?.cardEntries.length || summary?.cashEntries.length) ? (
        <TipsSection title="Daily breakdown" summary="Card + cash, night by night">
          <Card title="Daily breakdown" subtitle={`Card and cash tips taken at ${venue || 'this venue'}, night by night.`}>
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    <th>Card tips</th>
                    <th>Cash tips</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const byDate = new Map<string, { square: number; cash: number }>();
                    for (const e of (summary?.cardEntries ?? [])) {
                      const d = e.serviceDate.slice(0, 10);
                      const cur = byDate.get(d) ?? { square: 0, cash: 0 };
                      cur.square += e.amountCents;
                      byDate.set(d, cur);
                    }
                    for (const e of (summary?.cashEntries ?? [])) {
                      const d = e.serviceDate.slice(0, 10);
                      const cur = byDate.get(d) ?? { square: 0, cash: 0 };
                      cur.cash += e.amountCents;
                      byDate.set(d, cur);
                    }
                    return Array.from(byDate.entries())
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([date, row]) => {
                        const dayName = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
                        return (
                          <tr key={date}>
                            <td>{date}</td>
                            <td>{dayName}</td>
                            <td>{formatCents(row.square)}</td>
                            <td>{row.cash ? formatCents(row.cash) : <span className="subtle">—</span>}</td>
                            <td><strong>{formatCents(row.square + row.cash)}</strong></td>
                          </tr>
                        );
                      });
                  })()}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><strong>Total</strong></td>
                    <td><strong>{formatCents(summary?.squareTipsCents ?? 0)}</strong></td>
                    <td><strong>{formatCents(summary?.cashTipsCents ?? 0)}</strong></td>
                    <td><strong>{formatCents(summary?.tipPoolCents ?? 0)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </TipsSection>
      ) : null}

      {/* Import card tips — one-click per venue */}
      <TipsSection title="Import card tips" summary="Square import or manual CSV">
        <Card title="Import card tips" subtitle="One-click Square import for each venue, or paste a CSV manually.">
          <div className="tips-import-row">
            <div className="tips-import-venue-group">
              <strong>Alma Avalon</strong>
              <div className="toolbar">
                <Button
                  type="button"
                  onClick={() => void importSquareTips('Alma Avalon')}
                  disabled={saving}
                >
                  {saving && messageTarget === 'square-import' && venue === 'Alma Avalon' ? 'Importing…' : 'Import from Square'}
                </Button>
              </div>
            </div>
            <div className="tips-import-venue-group">
              <strong>St Alma</strong>
              <div className="toolbar">
                <Button
                  type="button"
                  onClick={() => void importSquareTips('St Alma')}
                  disabled={saving}
                >
                  {saving && messageTarget === 'square-import' && venue === 'St Alma' ? 'Importing…' : 'Import from Square'}
                </Button>
              </div>
            </div>
          </div>
          <ActionFeedback
            message={messageTarget === 'square-import' ? message : null}
            tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
          />
          <details className="staff-profile-collapsible">
            <summary>Manual CSV import</summary>
            <div className="form-grid two">
              <Select
                label="Source"
                value={cardImportSource}
                onChange={(event) => setCardImportSource(event.currentTarget.value)}
                options={[
                  { label: 'Alma Control', value: 'control' },
                  { label: 'Square', value: 'square' },
                  { label: 'Other', value: 'card' }
                ]}
              />
              <Input label="Default venue" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} placeholder="Alma Avalon" />
            </div>
            <Textarea
              label="CSV rows"
              rows={6}
              value={cardImportText}
              onChange={(event) => setCardImportText(event.currentTarget.value)}
              placeholder="date,venue,tips&#10;2026-05-04,Alma Avalon,125.50"
            />
            <div className="toolbar-right">
              <Button type="button" variant="secondary" onClick={downloadTipsTemplate}>Download template</Button>
              <Button type="button" variant="secondary" onClick={() => setCardImportText('')} disabled={saving || !cardImportText.trim()}>Clear</Button>
              <Button type="button" disabled={saving || !cardImportText.trim()} onClick={() => void importCardTips()}>
                {saving && messageTarget === 'import' ? 'Importing…' : 'Import card tips'}
              </Button>
              <ActionFeedback
                message={messageTarget === 'import' ? message : null}
                tone={message?.includes('Could') || message?.includes('Choose') || message?.includes('Paste') ? 'error' : 'success'}
              />
            </div>
          </details>
        </Card>
      </TipsSection>

      {/* Add cash tips */}
      <TipsSection title="Add cash tips" summary="Enter cash pool by service date">
        <Card title="Add cash tips" subtitle="Enter the cash tip pool for a service date. Enter $0 to clear that date.">
          <div className="tips-day-picker" aria-label="Cash tip service dates">
            {weekDays(weekStart).map((day) => (
              <button
                key={day.toISOString()}
                type="button"
                className={serviceDate === toDateInput(day) ? 'active' : undefined}
                onClick={() => setServiceDate(toDateInput(day))}
              >
                <span>{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                <strong>{day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</strong>
              </button>
            ))}
          </div>
          <div className="form-grid three">
            <Select label="Venue" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} options={venueOptions} />
            <Input label="Service date" type="date" value={serviceDate} onChange={(event) => setServiceDate(event.currentTarget.value)} />
            <Input label="Cash tips ($)" type="number" min="0" step="0.01" value={cashAmount} onChange={(event) => setCashAmount(event.currentTarget.value)} placeholder="0.00" />
          </div>
          <Input label="Notes" value={cashNotes} onChange={(event) => setCashNotes(event.currentTarget.value)} placeholder="Optional notes" />
          <div className="toolbar-right">
            <Button type="button" disabled={saving || !venue} onClick={() => void saveCashTips()}>
              {saving && messageTarget === 'cash' ? 'Saving…' : 'Save cash tips'}
            </Button>
            <ActionFeedback
              message={messageTarget === 'cash' ? message : null}
              tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
            />
          </div>
        </Card>
      </TipsSection>

      {/* Entries for this week — with delete */}
      <TipsSection title="This week's entries" summary={`${(summary?.cashEntries.length ?? 0) + (summary?.cardEntries.length ?? 0)} entries`}>
        <Card
          title="This week's entries"
          subtitle="Cash and card entries for the selected week and venue."
          action={
            (summary?.cashEntries.length || summary?.cardEntries.length) ? (
              <div className="toolbar">
                <Button type="button" size="sm" variant="ghost" onClick={() => void bulkDeleteEntries('cash')} disabled={bulkDeleting || !summary?.cashEntries.length}>Delete all cash</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => void bulkDeleteEntries('card')} disabled={bulkDeleting || !summary?.cardEntries.length}>Delete all card</Button>
              </div>
            ) : undefined
          }
        >
          <div className="tips-section-stack">
            <div>
              <strong>Cash entries</strong>
              <div className="staff-list">
                {(summary?.cashEntries ?? []).map((entry) => (
                  <article key={entry.id} className="staff-list-button tips-row">
                    <span>
                      <strong>{new Date(entry.serviceDate).toLocaleDateString()}</strong>
                      <span className="subtle">{entry.venue}{entry.notes ? ` · ${entry.notes}` : ''}</span>
                    </span>
                    <div className="tips-row-right">
                      <Badge tone="warning">{formatCents(entry.amountCents)}</Badge>
                      <Button type="button" size="sm" variant="ghost" onClick={() => void deleteCashEntry(entry.id)} disabled={saving}>✕</Button>
                    </div>
                  </article>
                ))}
              </div>
              {!loading && (summary?.cashEntries.length ?? 0) === 0 ? <p className="subtle">No cash tips entered this week.</p> : null}
            </div>
            <div>
              <strong>Card entries</strong>
              <div className="staff-list">
                {(summary?.cardEntries ?? []).map((entry) => (
                  <article key={entry.id} className="staff-list-button tips-row">
                    <span>
                      <strong>{new Date(entry.serviceDate).toLocaleDateString()}</strong>
                      <span className="subtle">{entry.venue} · {entry.source}{entry.notes ? ` · ${entry.notes}` : ''}</span>
                    </span>
                    <div className="tips-row-right">
                      <Badge tone="info">{formatCents(entry.amountCents)}</Badge>
                      <Button type="button" size="sm" variant="ghost" onClick={() => void deleteCardEntry(entry.id)} disabled={saving}>✕</Button>
                    </div>
                  </article>
                ))}
              </div>
              {!loading && (summary?.cardEntries.length ?? 0) === 0 ? <p className="subtle">No card tips imported this week.</p> : null}
            </div>
            {(summary?.paidRuns.length ?? 0) > 0 ? (
              <div>
                <strong>Paid runs</strong>
                <div className="staff-list">
                  {(summary?.paidRuns ?? []).map((run) => (
                    <article key={run.id} className="staff-list-button tips-row">
                      <span>
                        <strong>{formatCents(run.tipPoolCents)}</strong>
                        <span className="subtle">{new Date(run.paidAt).toLocaleString()} · {run.lineCount} staff</span>
                      </span>
                      <Badge tone="positive">Paid</Badge>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      </TipsSection>

      {/* Manual staff hours */}
      <TipsSection title="Hours for allocation" summary={`${summary?.manualHoursEntries.length ?? 0} manual entries`}>
        <Card
          title="Hours for allocation"
          subtitle="The tip pool splits by hours. Import the week's hours straight from Deputy timesheets, or add a staff member by hand."
          action={
            <Button type="button" variant="secondary" disabled={saving} onClick={() => void importDeputyHours()}>
              {saving && messageTarget === 'deputy-import' ? 'Importing…' : 'Import hours from Deputy'}
            </Button>
          }
        >
          <ActionFeedback
            message={messageTarget === 'deputy-import' ? message : null}
            tone={message?.includes('Could') || message?.includes('No Deputy') ? 'error' : 'success'}
          />
          <div className="form-grid three">
            <div className="staff-picker">
              <Select
                label="Staff member"
                value={manualStaffId}
                onChange={(event) => setManualStaffId(event.currentTarget.value)}
                options={[{ value: '', label: 'Choose staff…' }, ...staffOptions]}
              />
              <ShowTerminatedStaffToggle staff={staff} checked={showTerminatedStaff} onChange={setShowTerminatedStaff} />
            </div>
            <Input label="Hours" type="number" min="0.25" step="0.25" value={manualHours} onChange={(event) => setManualHours(event.currentTarget.value)} placeholder="e.g. 6.5" />
            <Input label="Notes" value={manualNotes} onChange={(event) => setManualNotes(event.currentTarget.value)} placeholder="Optional notes" />
          </div>
          <div className="toolbar-right">
            <Button type="button" disabled={saving || !manualStaffId || !manualHours} onClick={() => void saveManualHours()}>
              {saving && messageTarget === 'manual' ? 'Saving…' : 'Add to allocation'}
            </Button>
            <ActionFeedback
              message={messageTarget === 'manual' ? message : null}
              tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
            />
          </div>
          {(summary?.manualHoursEntries.length ?? 0) > 0 ? (
            <div className="staff-list" style={{ marginTop: 12 }}>
              {(summary?.manualHoursEntries ?? []).map((entry) => (
                <article key={entry.id} className="staff-list-button tips-row">
                  <span>
                    <strong>{entry.staffName}</strong>
                    <span className="subtle">{entry.hours}h manual · {entry.venue}{entry.notes ? ` · ${entry.notes}` : ''}</span>
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void deleteManualHoursEntry(entry.id)} disabled={saving}>✕</Button>
                </article>
              ))}
            </div>
          ) : null}
        </Card>
      </TipsSection>

      {/* Roster & pay Turn 2: distribution overview — proportional bars in each
          staff member's role accent colour. Adjustments still happen below. */}
      {reviewedRows.length ? (
        <TipsSection title="Distribution" summary={`By hours worked · ${roundHours(summary?.approvedHours ?? 0)} pooled`}>
          <div className="tips-distribution-card">
            <header className="tips-distribution-head">
              <h3>Distribution</h3>
              <span>By hours worked · {roundHours(summary?.approvedHours ?? 0)} pooled</span>
            </header>
            <div className="tips-distribution-rows">
              {(() => {
                const maxCents = Math.max(1, ...reviewedRows.map((row) => row.finalAmountCents));
                return reviewedRows.map((row) => {
                  const member = staff.find((candidate) => candidate.id === row.staffProfileId);
                  const roleTitle = row.roleTitle ?? member?.roleTitle ?? 'Team member';
                  return (
                    <div
                      key={row.staffProfileId}
                      className={`tips-distribution-row${row.excluded ? ' is-excluded' : ''}`}
                      style={areaStyle(roleTitle)}
                    >
                      <span className="tips-distribution-avatar" aria-hidden>
                        {member
                          ? staffInitials(member)
                          : (row.name.split(' ').map((part) => part[0] ?? '').slice(0, 2).join('') || 'SP').toUpperCase()}
                      </span>
                      <span className="tips-distribution-who">
                        <strong>{row.name}</strong>
                        <small>{roleTitle}</small>
                      </span>
                      <span className="tips-distribution-bar">
                        <span style={{ width: `${Math.max(2, Math.round((row.finalAmountCents / maxCents) * 100))}%` }} />
                      </span>
                      <span className="tips-distribution-hours">{row.approvedHours.toFixed(1)}h</span>
                      <span className="tips-distribution-amount">{formatCents(row.finalAmountCents)}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </TipsSection>
      ) : null}

      {/* Payroll status + entitlements */}
      <TipsSection title="Staff entitlements" summary={`${reviewedRows.length} staff · ${hasPaidRun ? 'approved' : 'waiting for review'}`}>
        <Card title="Staff entitlements" subtitle={`${venue || 'This venue'}'s tip pool split by approved hours. Review and adjust before locking.`} padding="none" className="tips-entitlements-card">
        <div className="tips-status-bar">
          <div className={`tips-status-panel ${hasPaidRun ? 'is-locked' : ''}`}>
            <span>
              <strong>{hasPaidRun ? 'Approved tip run locked' : 'Waiting for review'}</strong>
              <span className="subtle">
                {hasPaidRun
                  ? 'Reports payroll export will use the latest paid run for this week and venue.'
                  : 'Review, then approve and pay at the bottom to lock the run for payroll.'}
              </span>
            </span>
            <Badge tone={hasPaidRun ? 'positive' : 'warning'}>{hasPaidRun ? 'Payroll ready' : 'Waiting for review'}</Badge>
          </div>
          <div style={{ padding: '0 16px 12px' }}>
            <Input label="Paid run notes" value={payoutNotes} onChange={(event) => setPayoutNotes(event.currentTarget.value)} placeholder="Optional notes for payroll" />
          </div>
        </div>
        {!loading && !reviewedRows.length ? (
          <EmptyState title="No tip entitlements yet" description="Approve timesheets, import tips, and add manual hours to calculate staff payouts." />
        ) : null}
        {reviewedRows.length ? (
          <div className="table-card tips-table">
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Role</th>
                  <th>Hours</th>
                  <th>Base tips</th>
                  <th>Adjust</th>
                  <th>Final</th>
                  <th>Pay</th>
                </tr>
              </thead>
              <tbody>
                {reviewedRows.map((row) => (
                  <tr key={row.staffProfileId}>
                    <td><strong>{row.name}</strong></td>
                    <td>{row.roleTitle ?? 'Team member'}</td>
                    <td>{row.approvedHours.toFixed(2)}</td>
                    <td>{formatCents(row.amountCents)}</td>
                    <td>
                      <Input
                        aria-label={`Tip adjustment for ${row.name}`}
                        type="number"
                        step="0.01"
                        value={adjustments[row.staffProfileId]?.adjustment ?? ''}
                        onChange={(event) => updateTipAdjustment(row.staffProfileId, { adjustment: event.currentTarget.value })}
                        disabled={row.excluded}
                        placeholder="0.00"
                      />
                    </td>
                    <td>
                      <strong>{formatCents(row.finalAmountCents)}</strong>
                      {row.adjustmentCents !== 0 ? <span className="subtle"> {row.adjustmentCents > 0 ? '+' : ''}{formatCents(row.adjustmentCents)}</span> : null}
                    </td>
                    <td>
                      <div className="tips-review-actions">
                        <Badge tone={row.excluded ? 'muted' : row.paidInCash ? 'positive' : 'warning'}>
                          {row.excluded ? 'Excluded' : row.paidInCash ? 'Paid in cash' : 'Bank file'}
                        </Badge>
                        <label className="inline-checkbox" title="Removes their hours from the split — the pool redistributes across everyone else and the payout still balances.">
                          <input
                            type="checkbox"
                            checked={row.excluded}
                            disabled={row.paidInCash}
                            onChange={(event) => updateTipAdjustment(row.staffProfileId, { excluded: event.currentTarget.checked })}
                          />
                          Exclude
                        </label>
                        <label className="inline-checkbox" title="They were handed their share in cash. The amount stands and nobody else's changes — the bank file just leaves them out.">
                          <input
                            type="checkbox"
                            checked={row.paidInCash}
                            disabled={row.excluded}
                            onChange={(event) => updateTipAdjustment(row.staffProfileId, { paidInCash: event.currentTarget.checked })}
                          />
                          Paid in cash
                        </label>
                        <Input
                          aria-label={`Tip note for ${row.name}`}
                          value={adjustments[row.staffProfileId]?.notes ?? ''}
                          onChange={(event) => updateTipAdjustment(row.staffProfileId, { notes: event.currentTarget.value })}
                          placeholder="Note"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        </Card>
      </TipsSection>

      {lockedRows.length ? (
        <TipsSection title="Approved tip run" summary={`${lockedRows.length} staff locked for payroll`}>
          <Card
            title="Approved tip run"
            subtitle="This locked run is the source Reports uses for payroll tips."
            padding="none"
            action={
              <Button type="button" variant="secondary" disabled={saving} onClick={() => void removeLockedRun()}>
                {saving && messageTarget === 'paid' ? 'Removing…' : 'Remove locked run'}
              </Button>
            }
          >
            <div className="table-card tips-table">
              <table>
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Role</th>
                    <th>Hours</th>
                    <th>Paid tips</th>
                    <th>Paid by</th>
                  </tr>
                </thead>
                <tbody>
                  {lockedRows.map((row) => (
                    <tr key={row.staffProfileId}>
                      <td><strong>{row.name}</strong></td>
                      <td>{row.roleTitle ?? 'Team member'}</td>
                      <td>{row.approvedHours.toFixed(2)}</td>
                      <td>{formatCents(row.amountCents)}</td>
                      <td>{row.paidInCash ? 'Cash' : 'Bank file'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TipsSection>
      ) : null}

      <TipsSection title="Approve and pay" summary={hasPaidRun ? 'Export the approved run' : 'Final payroll approval'}>
        <Card title={hasPaidRun ? 'Approved run exports' : 'Approve and pay'} subtitle={hasPaidRun ? 'Export the locked tip run for bank payment or payroll records.' : 'Approve once the final payout balances to the tip pool.'}>
          <div className="tips-approval-footer">
            <div>
              <strong>{hasPaidRun ? 'Ready to export' : 'Waiting for review'}</strong>
              <p className="subtle">
                {hasPaidRun
                  ? `${lockedRows.length} staff · ${formatCents(lockedRows.reduce((sum, row) => sum + row.amountCents, 0))} approved${
                      lockedRows.some((row) => row.paidInCash)
                        ? ` · ${lockedRows.filter((row) => row.paidInCash).length} paid in cash, ${formatCents(lockedRows.filter((row) => !row.paidInCash).reduce((sum, row) => sum + row.amountCents, 0))} to the bank file`
                        : ''
                    }.`
                  : `${reviewedRows.length} staff · final payout ${formatCents(totalPayoutCents)} · variance ${formatCents(payoutVarianceCents)}.`}
              </p>
            </div>
            {!hasPaidRun ? (
              <Button type="button" onClick={() => void markPaid()} disabled={saving || !summary?.entitlements.length || payoutVarianceCents !== 0}>
                {saving && messageTarget === 'paid' ? 'Approving…' : 'Approve and pay'}
              </Button>
            ) : (
              <div className="toolbar">
                {abaAccounts.length > 0 ? (
                  <label className="subtle" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    Pay from
                    <select
                      value={abaAccountKey}
                      onChange={(event) => setAbaAccountKey(event.currentTarget.value)}
                      style={{ minWidth: 200 }}
                    >
                      <option value="">Choose bank account…</option>
                      {abaAccounts.map((account) => (
                        <option key={account.key} value={account.key}>
                          {account.label} ({account.maskedAccount})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <Button type="button" onClick={() => void exportTipsAba()} disabled={saving || !lockedRows.length}>
                  {saving && messageTarget === 'aba' ? 'Exporting…' : 'Export ABA'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => void exportTips()} disabled={saving || !lockedRows.length}>
                  {saving && messageTarget === 'export' ? 'Exporting…' : 'Export CSV'}
                </Button>
              </div>
            )}
          </div>
          <ActionFeedback
            message={['paid', 'aba', 'export'].includes(messageTarget ?? '') ? message : null}
            tone={message?.includes('Could') || message?.includes('Choose') || message?.includes('variance') || message?.includes('Cannot') || message?.includes('Approve') || message?.includes('already') || message?.includes('not configured') || message?.includes('No approved') ? 'error' : 'success'}
          />
        </Card>
      </TipsSection>
    </div>
  );
}

function TipsSection({
  title,
  summary,
  defaultOpen = true,
  children
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`tips-collapsible-section ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="tips-collapsible-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{title}</span>
        {summary ? <small>{summary}</small> : null}
      </button>
      {open ? <div className="tips-collapsible-body">{children}</div> : null}
    </section>
  );
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function normaliseImportedDate(value: string | undefined) {
  const raw = String(value ?? '').trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}T00:00:00`;
  const local = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (local) {
    const year = local[3].length === 2 ? `20${local[3]}` : local[3];
    return `${year}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}T00:00:00`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : `${toDateInput(parsed)}T00:00:00`;
}

function parseTipsImportRows(text: string, defaultVenue: string, source: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const findColumn = (names: string[]) => headers.findIndex((header) => names.includes(header));
  // 'saledate' and 'saleid' are the Lightspeed (Kounta) sales feed export,
  // pasted as-is: one row per sale with its own timestamp, so a day's tips
  // are dated by the sale and keyed by the sale id. That export cannot be
  // scheduled as an email, and the emailed reconciliation report repeats each
  // day's tips three times, so the paste is Avalon's card-tips path.
  const dateIndex = findColumn(['date', 'servicedate', 'businessdate', 'day', 'saledate']);
  const venueIndex = findColumn(['venue', 'location', 'site']);
  const amountIndex = findColumn(['tips', 'tip', 'cardtips', 'squaretips', 'amount', 'tipamount', 'totaltips', 'totalgratuity', 'gratuity', 'nettips']);
  const idIndex = findColumn(['id', 'externalid', 'paymentid', 'transactionid', 'orderid', 'receiptid', 'checkid', 'saleid']);
  const notesIndex = findColumn(['notes', 'note', 'source']);
  if (dateIndex < 0 || amountIndex < 0) return [];

  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    const serviceDate = normaliseImportedDate(cells[dateIndex]);
    const amountCents = parseMoneyCents(cells[amountIndex]);
    const venue = cells[venueIndex]?.trim() || defaultVenue;
    if (!serviceDate || !venue || amountCents <= 0) return null;
    const externalId = cells[idIndex]?.trim() || `${serviceDate}-${venue}-${amountCents}-${index}`;
    return {
      venue,
      serviceDate,
      amountCents,
      source,
      externalId,
      importKey: `${source}:${venue}:${externalId}`,
      notes: cells[notesIndex]?.trim() || ''
    };
  }).filter((row): row is NonNullable<typeof row> => Boolean(row));
}
