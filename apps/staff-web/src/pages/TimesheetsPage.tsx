// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHubTabBadge } from '../components/HubTabs';
import type { RosterShift, StaffClockSession, StaffProfile, Timesheet } from '@alma/shared';
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
import { useAuth } from '../lib/auth';
import {
  startOfWeek,
  addDays,
  shiftTimeRange,
  timeOf,
  toDateInput,
  toTimeInput,
  formatRange,
  roundHours,
  uniqueValues,
  timesheetHours
} from '../lib/datetime';
import {
  staffForPicker,
  ShowTerminatedStaffToggle,
  staffInitials,
  sortStaffForSelect,
  areaStyle,
  downloadTextFile
} from './shared';

type TimesheetGroup = {
  id: string;
  member: StaffProfile | undefined;
  name: string;
  venue: string;
  roleTitle: string;
  entries: Timesheet[];
  totalHours: number;
  submittedIds: string[];
  approvedCount: number;
};

// Group timesheets by staff member. Each group exposes the member's display
// name, derived venue/role, total hours, the ids that still need approval
// (SUBMITTED or REJECTED) and how many are already approved. Entries are sorted
// newest-first; groups are sorted alphabetically by name.
function groupTimesheetsByStaff(entries: Timesheet[], staff: StaffProfile[]): TimesheetGroup[] {
  const map = new Map<string, { id: string; member: StaffProfile | undefined; name: string; entries: Timesheet[] }>();
  for (const entry of entries) {
    const id = entry.staffProfileId;
    let group = map.get(id);
    if (!group) {
      const member = staff.find((candidate) => candidate.id === id);
      const name = entry.staffProfile
        ? `${entry.staffProfile.firstName} ${entry.staffProfile.lastName}`.trim()
        : member
          ? `${member.firstName} ${member.lastName}`.trim()
          : 'Staff member';
      group = { id, member, name, entries: [] };
      map.set(id, group);
    }
    group.entries.push(entry);
  }
  return Array.from(map.values())
    .map((group) => {
      const entries = [...group.entries].sort(
        (a, b) => new Date(b.workDate).getTime() - new Date(a.workDate).getTime()
      );
      return {
        ...group,
        entries,
        venue: group.member?.venue ?? entries[0]?.staffProfile?.venue ?? entries[0]?.venue ?? '',
        roleTitle: group.member?.roleTitle ?? entries[0]?.staffProfile?.roleTitle ?? '',
        totalHours: entries.reduce((sum, entry) => sum + timesheetHours(entry), 0),
        submittedIds: entries
          .filter((entry) => entry.status === 'SUBMITTED' || entry.status === 'REJECTED')
          .map((entry) => entry.id),
        approvedCount: entries.filter((entry) => entry.status === 'APPROVED').length
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Which slice of the explorer the manager is currently focused on.
type TimesheetSelection = { type: 'all' } | { type: 'venue'; venue: string } | { type: 'staff'; id: string };

export function TimesheetsPage({ staff, roster = [] }: { staff: StaffProfile[]; roster?: RosterShift[] }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  // Range mode: 'week' uses the week navigator; '30'/'90' look back N days.
  const [rangeMode, setRangeMode] = useState<'week' | '30' | '90'>('week');
  const [statusFilter, setStatusFilter] = useState<'all' | Timesheet['status']>('all');
  const [venueFilter, setVenueFilter] = useState('all');
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [staffProfileId, setStaffProfileId] = useState(staff[0]?.id ?? '');
  const [showTerminatedStaff, setShowTerminatedStaff] = useState(false);
  const [workDate, setWorkDate] = useState(() => toDateInput(new Date()));
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('16:00');
  const [breakMinutes, setBreakMinutes] = useState('30');
  const [area, setArea] = useState('Floor');
  const [paymentMethod, setPaymentMethod] = useState<'XERO' | 'CASH'>('XERO');
  const [xeroEmployeeId, setXeroEmployeeId] = useState('');
  const [xeroEarningsRateId, setXeroEarningsRateId] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedRosterShiftId, setSelectedRosterShiftId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [clockSessions, setClockSessions] = useState<StaffClockSession[]>([]);
  // Submit-new-timesheet modal visibility.
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  // Manual adjustment: the row being edited, and its form. The API has let
  // managers correct hours up to APPROVED for a while — this is the door.
  const [editEntry, setEditEntry] = useState<Timesheet | null>(null);
  const [editForm, setEditForm] = useState({ workDate: '', start: '', end: '', breakMinutes: '0', venue: '', area: '', notes: '' });
  // Explorer rail selection (all / a venue / a staff member).
  const [selection, setSelection] = useState<TimesheetSelection>({ type: 'all' });
  // Week review is a tall table and a manager reviewing one person doesn't
  // want to scroll past everyone else. Collapsed state is remembered so it
  // survives week navigation rather than springing open on every arrow press.
  // Who gets pushed. Empty = everyone in the window, which is the common case;
  // ticking anyone narrows it so a manager can push one person's corrected week
  // without re-sending the whole payroll.
  const [pushSelection, setPushSelection] = useState<string[]>([]);
  // The per-employee outcome of the last push/preview. A one-line summary hid
  // the only thing that matters when 11 of 19 fail — which people, and why.
  const [pushResult, setPushResult] = useState<
    | {
        preview: boolean;
        pushed: number;
        failed: number;
        skipped: number;
        markedExported: number;
        rows: { employee: string; status: string; message: string; periodStart: string | null; periodEnd: string | null }[];
      }
    | null
  >(null);
  // Reassign-shifts control: which staff group has the picker open, and who
  // the shifts are being moved to.
  const [reassignGroupKey, setReassignGroupKey] = useState<string | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState('');
  const [reviewOpen, setReviewOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('alma.timesheets.reviewOpen') !== 'closed';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('alma.timesheets.reviewOpen', reviewOpen ? 'open' : 'closed');
  }, [reviewOpen]);
  // A STAFF member only ever sees their own hours (server forces this), so hide
  // the manager-only approval/payroll affordances from them.
  const { user: timesheetsViewer } = useAuth();
  const isManagerView = timesheetsViewer?.role !== 'STAFF';

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  // Effective query window: the navigated week, or a rolling N-day lookback.
  const rangeStart = useMemo(
    () => (rangeMode === 'week' ? weekStart : addDays(new Date(), -Number(rangeMode))),
    [rangeMode, weekStart]
  );
  const rangeEnd = useMemo(
    () => (rangeMode === 'week' ? weekEnd : addDays(new Date(), 1)),
    [rangeMode, weekEnd]
  );
  const selectedMember = staff.find((member) => member.id === staffProfileId);
  const venueOptions = useMemo(
    () => [
      { label: 'All venues', value: 'all' },
      ...uniqueValues(staff.map((member) => member.venue).filter(Boolean) as string[]).map((venue) => ({
        label: venue,
        value: venue
      }))
    ],
    [staff]
  );
  const submittedCount = timesheets.filter((entry) => entry.status === 'SUBMITTED').length;
  const approvedCount = timesheets.filter((entry) => entry.status === 'APPROVED').length;
  const approvedHours = timesheets
    .filter((entry) => entry.status === 'APPROVED')
    .reduce((sum, entry) => sum + timesheetHours(entry), 0);
  const rosterShiftsForSelected = useMemo(
    () =>
      roster
        .filter((shift) => shift.staffProfileId === staffProfileId && shift.status !== 'CANCELLED')
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [roster, staffProfileId]
  );

  // All loaded timesheets grouped by staff member (powers the staff rail).
  const allGroups = useMemo(() => groupTimesheetsByStaff(timesheets, staff), [timesheets, staff]);

  // Per-venue counts for the explorer rail's "Locations" section.
  const venueSummaries = useMemo(() => {
    const map = new Map<string, { venue: string; count: number; submitted: number; approved: number }>();
    for (const entry of timesheets) {
      const venue = entry.venue || entry.staffProfile?.venue || 'No venue';
      const summary = map.get(venue) ?? { venue, count: 0, submitted: 0, approved: 0 };
      summary.count += 1;
      if (entry.status === 'SUBMITTED' || entry.status === 'REJECTED') summary.submitted += 1;
      if (entry.status === 'APPROVED') summary.approved += 1;
      map.set(venue, summary);
    }
    return Array.from(map.values()).sort((a, b) => a.venue.localeCompare(b.venue));
  }, [timesheets]);

  // Overall counts shown against the "All timesheets" rail item.
  const overallCounts = useMemo(
    () => ({
      count: timesheets.length,
      submitted: timesheets.filter((entry) => entry.status === 'SUBMITTED' || entry.status === 'REJECTED').length,
      approved: timesheets.filter((entry) => entry.status === 'APPROVED').length
    }),
    [timesheets]
  );

  // Roster & pay Turn 2: surface the needs-review count on the hub's Timesheets tab.
  useHubTabBadge('/timesheets', overallCounts.submitted);

  // The roster prop is loaded once, for the fortnight starting this Monday.
  // Payroll review is always looking at a week that has already finished, so
  // that window never contains the shifts being reviewed and every Rostered
  // cell read "—". This page fetches the roster for its own range instead.
  const [rangeRoster, setRangeRoster] = useState<RosterShift[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ start: rangeStart.toISOString(), end: rangeEnd.toISOString() });
    api<RosterShift[]>(`/api/staff/roster?${params.toString()}`)
      .then((shifts) => {
        if (!cancelled) setRangeRoster(shifts);
      })
      .catch(() => {
        // Fall back to the prop rather than blanking the column outright.
        if (!cancelled) setRangeRoster(null);
      });
    return () => {
      cancelled = true;
    };
  }, [rangeStart, rangeEnd]);

  // Rostered hours per staff member inside the current range.
  const rosteredHoursByStaff = useMemo(() => {
    const map = new Map<string, number>();
    for (const shift of rangeRoster ?? roster) {
      if (!shift.staffProfileId || shift.status === 'CANCELLED') continue;
      const startsAt = new Date(shift.startsAt);
      const endsAt = new Date(shift.endsAt);
      if (endsAt.getTime() <= rangeStart.getTime() || startsAt.getTime() >= rangeEnd.getTime()) continue;
      const hours = Math.max(0, (endsAt.getTime() - startsAt.getTime()) / 3600000 - (shift.breakMinutes ?? 0) / 60);
      map.set(shift.staffProfileId, (map.get(shift.staffProfileId) ?? 0) + hours);
    }
    return map;
  }, [rangeRoster, roster, rangeStart, rangeEnd]);

  // Groups filtered to the current explorer selection (shown in the detail pane).
  const visibleGroups = useMemo(() => {
    const filtered = timesheets.filter((entry) => {
      if (selection.type === 'all') return true;
      if (selection.type === 'staff') return entry.staffProfileId === selection.id;
      return (entry.venue || entry.staffProfile?.venue || 'No venue') === selection.venue;
    });
    return groupTimesheetsByStaff(filtered, staff);
  }, [timesheets, staff, selection]);

  const detailTitle =
    selection.type === 'all'
      ? 'All timesheets'
      : selection.type === 'venue'
        ? selection.venue
        : allGroups.find((group) => group.id === selection.id)?.name ?? 'Employee';

  const loadTimesheets = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const query = new URLSearchParams({
        start: rangeStart.toISOString(),
        end: rangeEnd.toISOString(),
        status: statusFilter,
        venue: venueFilter
      });
      setTimesheets(await api<Timesheet[]>(`/api/staff/timesheets?${query.toString()}`));

      // Fetch clock sessions for the same window to power timesheet
      // reconciliation. Gracefully no-op if the endpoint isn't deployed.
      try {
        const clockQuery = new URLSearchParams({
          start: rangeStart.toISOString(),
          end: rangeEnd.toISOString(),
          venue: venueFilter
        });
        const sessions = await api<StaffClockSession[]>(`/api/staff/clock-sessions?${clockQuery.toString()}`);
        setClockSessions(sessions);
      } catch {
        setClockSessions([]);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load timesheets.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, venueFilter, rangeEnd, rangeStart]);

  useEffect(() => {
    if (!staffProfileId && staff[0]) setStaffProfileId(staff[0].id);
  }, [staff, staffProfileId]);

  useEffect(() => {
    setXeroEmployeeId(selectedMember?.xeroEmployeeId ?? '');
    setXeroEarningsRateId(selectedMember?.xeroEarningsRateId ?? '');
  }, [selectedMember?.id, selectedMember?.xeroEarningsRateId, selectedMember?.xeroEmployeeId]);

  useEffect(() => {
    void loadTimesheets();
  }, [loadTimesheets]);

  async function submitTimesheet() {
    setMessageTarget('submit');
    const range = shiftTimeRange(workDate, startTime, endTime);
    if (!selectedMember || !range) {
      setMessage('Choose a staff member and valid times.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api('/api/staff/timesheets', {
        method: 'POST',
        body: JSON.stringify({
          staffProfileId,
          rosterShiftId: selectedRosterShiftId,
          venue: selectedMember.venue ?? '',
          area,
          roleTitle: selectedMember.roleTitle,
          workDate: `${workDate}T00:00:00`,
          clockInAt: range.startsAt.toISOString(),
          clockOutAt: range.endsAt.toISOString(),
          breakMinutes: Number(breakMinutes) || 0,
          notes,
          status: 'SUBMITTED',
          xeroEmployeeId,
          xeroEarningsRateId,
          paymentMethod
        })
      });
      setMessage('Timesheet submitted.');
      setNotes('');
      setSelectedRosterShiftId('');
      setShowSubmitModal(false);
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not submit timesheet.');
    } finally {
      setSaving(false);
    }
  }

  async function markCashPaid(id: string) {
    const cashNotes = window.prompt('Cash payment notes (optional)') ?? '';
    setSaving(true);
    setMessage(null);
    setMessageTarget(`cash:${id}`);
    try {
      await api(`/api/staff/timesheets/${id}/cash-paid`, {
        method: 'POST',
        body: JSON.stringify({ notes: cashNotes })
      });
      setMessage('Cash payment recorded.');
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not record cash payment.');
    } finally {
      setSaving(false);
    }
  }

  function prefillFromShift(shift: RosterShift) {
    setMessageTarget(`prefill:${shift.id}`);
    setSelectedRosterShiftId(shift.id);
    setStaffProfileId(shift.staffProfileId ?? '');
    setWorkDate(toDateInput(new Date(shift.startsAt)));
    setStartTime(toTimeInput(new Date(shift.startsAt)));
    setEndTime(toTimeInput(new Date(shift.endsAt)));
    setBreakMinutes(String(shift.breakMinutes));
    setArea(shift.area || 'Floor');
    setNotes(`From roster: ${timeOf(shift.startsAt)}-${timeOf(shift.endsAt)} ${shift.area || 'Shift'}`);
    setMessage('Roster shift loaded. Adjust actual times before submitting.');
  }

  /**
   * Approving refetched the whole timesheet list — 122 KB here, and a manager
   * approving a fortnight one row at a time paid it every time. The row now
   * flips on the click and only rolls back if the server refuses.
   */
  async function approve(id: string) {
    setMessage(null);
    setMessageTarget(`approve:${id}`);
    const snapshot = timesheets;
    setTimesheets((current) => current.map((sheet) =>
      sheet.id === id ? { ...sheet, status: 'APPROVED', approvedAt: new Date().toISOString() } : sheet));
    try {
      await api(`/api/staff/timesheets/${id}/approve`, { method: 'POST', body: JSON.stringify({}) });
      setMessage('Timesheet approved.');
    } catch (err) {
      setTimesheets(snapshot);
      setMessage(err instanceof Error ? `Could not approve — ${err.message.replace(/\.\s*$/, '')}. Put back as it was.` : 'Could not approve timesheet.');
    }
  }

  /**
   * Bulk-approve a group.
   *
   * This used Promise.all, so a single rejected row failed the whole call and
   * the manager was told nothing was approved — while the rest had in fact
   * gone through. The list then refetched and silently disagreed with the
   * message. Now every row is attempted, only the ones that actually failed
   * are put back, and the count reported is the count that succeeded.
   */
  async function approveGroup(ids: string[]) {
    if (ids.length === 0) return;
    setMessageTarget('approve-group');
    setSaving(true);
    setMessage(null);
    const snapshot = timesheets;
    const pending = new Set(ids);
    setTimesheets((current) => current.map((sheet) =>
      pending.has(sheet.id) ? { ...sheet, status: 'APPROVED', approvedAt: new Date().toISOString() } : sheet));
    try {
      const results = await Promise.allSettled(
        ids.map((id) => api(`/api/staff/timesheets/${id}/approve`, { method: 'POST', body: JSON.stringify({}) }))
      );
      const failedIds = ids.filter((_, index) => results[index]!.status === 'rejected');
      if (failedIds.length > 0) {
        const failed = new Set(failedIds);
        const before = new Map(snapshot.map((sheet) => [sheet.id, sheet]));
        setTimesheets((current) => current.map((sheet) => (failed.has(sheet.id) ? before.get(sheet.id) ?? sheet : sheet)));
      }
      const approved = ids.length - failedIds.length;
      setMessage(
        failedIds.length === 0
          ? `Approved ${approved} timesheet${approved === 1 ? '' : 's'}.`
          : `Approved ${approved} of ${ids.length}. ${failedIds.length} could not be approved and ${failedIds.length === 1 ? 'has' : 'have'} been left as ${failedIds.length === 1 ? 'it was' : 'they were'}.`
      );
    } finally {
      setSaving(false);
    }
  }

  /**
   * Move shifts to a different staff profile — approved ones included.
   *
   * This exists for the phantom identities imports create ("Andres Felipe
   * valdes" holding a week of real shifts while "Andres Felipe Gallo" holds
   * the bank details): pick the right person, move the shifts, and the pay
   * run and tips allocation follow without any reject/re-approve dance. The
   * server stamps an audit note on each moved row.
   */
  async function reassignEntries(entryIds: string[], targetId: string) {
    if (!targetId || entryIds.length === 0) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget('reassign');
    try {
      const results = await Promise.allSettled(
        entryIds.map((id) => api(`/api/staff/timesheets/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ staffProfileId: targetId })
        }))
      );
      const failed = results.filter((result) => result.status === 'rejected');
      const movedCount = entryIds.length - failed.length;
      const targetName = staff.find((member) => member.id === targetId);
      const targetLabel = targetName ? `${targetName.firstName} ${targetName.lastName}` : 'the selected profile';
      if (failed.length === 0) {
        setMessage(`Moved ${movedCount} shift${movedCount === 1 ? '' : 's'} to ${targetLabel}.`);
      } else {
        const firstError = failed[0];
        const reason = firstError && firstError.status === 'rejected' && firstError.reason instanceof Error
          ? ` First error: ${firstError.reason.message}`
          : '';
        setMessage(`Moved ${movedCount} of ${entryIds.length} shifts to ${targetLabel} — ${failed.length} failed.${reason}`);
      }
      setReassignGroupKey(null);
      setReassignTargetId('');
      await loadTimesheets();
    } finally {
      setSaving(false);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt('Reason for rejection?') ?? '';
    setSaving(true);
    setMessage(null);
    setMessageTarget(`reject:${id}`);
    const snapshot = timesheets;
    setTimesheets((current) => current.map((sheet) =>
      sheet.id === id ? { ...sheet, status: 'REJECTED', rejectedAt: new Date().toISOString(), rejectionReason: reason } : sheet));
    try {
      await api(`/api/staff/timesheets/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      setMessage('Timesheet rejected.');
    } catch (err) {
      // Without this the row keeps showing REJECTED after a failed call, which
      // is worse than the refetch it replaced: the manager moves on believing
      // the rejection stuck.
      setTimesheets(snapshot);
      setMessage(
        err instanceof Error
          ? `Could not reject — ${err.message.replace(/\.\s*$/, '')}. Put back as it was.`
          : 'Could not reject timesheet.'
      );
    } finally {
      setSaving(false);
    }
  }

  // Push approved Xero timesheets straight into Xero as draft timesheets.
  // `preview` runs every lookup without writing, which is how you find out
  // who isn't linked to a Xero employee before anything lands in the pay run.
  async function pushToXero(preview = false) {
    if (
      !preview &&
      !window.confirm(
        'Push approved Xero timesheets for this period straight into Xero as draft timesheets? Review them in Xero before the pay run.'
      )
    ) {
      return;
    }
    setSaving(true);
    setMessage(null);
    setPushResult(null);
    setMessageTarget('push');
    try {
      const result = await api<{
        pushed: number;
        failed: number;
        skipped: number;
        markedExported: number;
        results: { employee: string; status: string; message: string; periodStart: string | null; periodEnd: string | null }[];
        warnings: string[];
      }>('/api/staff/timesheets/push/xero', {
        method: 'POST',
        body: JSON.stringify({
          start: rangeStart.toISOString(),
          end: rangeEnd.toISOString(),
          venue: venueFilter === 'all' ? '' : venueFilter,
          dryRun: preview,
          staffProfileIds: pushSelection
        })
      });
      // A push can partly succeed — one employee missing a Xero link doesn't
      // stop the rest — so the outcome is kept per employee and rendered as a
      // list. The reason on a failed row is the only thing that says what to fix.
      setPushResult({
        preview,
        pushed: result.pushed,
        failed: result.failed,
        skipped: result.skipped,
        markedExported: result.markedExported,
        rows: result.results
      });
      const parts = [
        preview
          ? `${result.pushed} timesheet${result.pushed === 1 ? '' : 's'} ready to push`
          : `Pushed ${result.pushed} timesheet${result.pushed === 1 ? '' : 's'} to Xero as drafts`,
        result.markedExported ? `${result.markedExported} shifts marked exported` : null,
        result.skipped ? `${result.skipped} skipped (no hours)` : null,
        result.failed ? `${result.failed} failed` : null
      ].filter(Boolean);
      setMessage(result.results.length === 0 ? (result.warnings[0] ?? 'Nothing to push.') : `${parts.join(' · ')}.`);
      if (!preview) await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not push timesheets to Xero.');
    } finally {
      setSaving(false);
    }
  }

  async function exportXero(markExported: boolean) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(markExported ? 'export' : 'preview');
    try {
      const result = await api<{ exportBatchId: string; count: number; csv: string; markedExported: boolean }>(
        '/api/staff/timesheets/export/xero',
        {
          method: 'POST',
          body: JSON.stringify({
            start: weekStart.toISOString(),
            end: weekEnd.toISOString(),
            venue: venueFilter,
            markExported
          })
        }
      );
      downloadTextFile(`alma-xero-timesheets-${toDateInput(weekStart)}.csv`, result.csv);
      setMessage(`${result.count} approved timesheets exported${result.markedExported ? ' and marked exported' : ''}.`);
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not export Xero timesheets.');
    } finally {
      setSaving(false);
    }
  }

  async function importFromXero() {
    setSaving(true);
    setMessage(null);
    setMessageTarget('import-xero');
    try {
      const result = await api<{ imported?: number; staffMatched?: number; warnings?: string[] }>(
        '/api/integrations/xero/sync-timesheets',
        { method: 'POST', body: JSON.stringify({}) }
      );
      const extra = result.warnings?.length ? ` ${result.warnings.join(' ')}` : '';
      setMessage(`Imported ${result.imported ?? 0} day-rows from Xero for ${result.staffMatched ?? 0} staff.${extra}`);
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not import from Xero.');
    } finally {
      setSaving(false);
    }
  }

  async function importFromDeputy() {
    setSaving(true);
    setMessage(null);
    setMessageTarget('import-deputy');
    try {
      const result = await api<{ timesheets?: { created?: number; updated?: number } }>(
        '/api/integrations/deputy/sync-timesheets',
        { method: 'POST' }
      );
      const created = result.timesheets?.created ?? 0;
      const updated = result.timesheets?.updated ?? 0;
      setMessage(`Imported from Deputy: ${created} new, ${updated} updated.`);
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not import from Deputy.');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(entry: Timesheet) {
    const toTimeInput = (iso: string) => {
      const at = new Date(iso);
      return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    };
    setEditForm({
      workDate: toDateInput(new Date(entry.workDate)),
      start: toTimeInput(entry.clockInAt),
      end: toTimeInput(entry.clockOutAt),
      breakMinutes: String(entry.breakMinutes ?? 0),
      venue: entry.venue ?? '',
      area: entry.area ?? '',
      notes: entry.notes ?? ''
    });
    setEditEntry(entry);
  }

  async function saveEdit() {
    if (!editEntry) return;
    setMessageTarget(`edit:${editEntry.id}`);
    const range = shiftTimeRange(editForm.workDate, editForm.start, editForm.end);
    if (!range) {
      setMessage('Could not read those times — check the date and both clock times.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/timesheets/${editEntry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          workDate: `${editForm.workDate}T00:00:00`,
          clockInAt: range.startsAt.toISOString(),
          clockOutAt: range.endsAt.toISOString(),
          breakMinutes: Number(editForm.breakMinutes) || 0,
          venue: editForm.venue,
          area: editForm.area,
          notes: editForm.notes
        })
      });
      setEditEntry(null);
      setMessage('Timesheet updated.');
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update the timesheet.');
    } finally {
      setSaving(false);
    }
  }

  // EXPORTED means a draft already sits in Xero. Unlocking re-arms the row for
  // the next push; the server's audit note (and the confirm here) both say the
  // stale draft must be deleted in Xero first, or the employee gets two.
  async function unexportEntry(entry: Timesheet) {
    if (!window.confirm('Unlock this shift for re-push? Delete its old draft timesheet in Xero first, or the employee ends up with two.')) return;
    setMessageTarget(`unexport:${entry.id}`);
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/timesheets/${entry.id}/unexport`, { method: 'POST', body: JSON.stringify({}) });
      setMessage('Unlocked — it will go with the next push to Xero.');
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not unlock the timesheet.');
    } finally {
      setSaving(false);
    }
  }

  function renderSubmitFields() {
    return (
      <>
        {rosterShiftsForSelected.length ? (
          <div className="timesheet-shift-picklist">
            {rosterShiftsForSelected.slice(0, 8).map((shift) => (
              <button
                key={shift.id}
                type="button"
                className={selectedRosterShiftId === shift.id ? 'is-selected' : ''}
                onClick={() => prefillFromShift(shift)}
              >
                <strong>{new Date(shift.startsAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
                <span>{timeOf(shift.startsAt)}-{timeOf(shift.endsAt)} · {shift.area || 'Shift'}</span>
                <ActionFeedback
                  message={messageTarget === `prefill:${shift.id}` ? message : null}
                  tone="success"
                />
              </button>
            ))}
          </div>
        ) : null}
        <div className="form-grid">
          {isManagerView ? (
            <div className="staff-picker">
              <Select
                label="Staff member"
                value={staffProfileId}
                onChange={(event) => setStaffProfileId(event.currentTarget.value)}
                options={sortStaffForSelect(staffForPicker(staff, showTerminatedStaff, staffProfileId)).map((member) => ({
                  label: `${member.firstName} ${member.lastName}`,
                  value: member.id
                }))}
              />
              <ShowTerminatedStaffToggle staff={staff} checked={showTerminatedStaff} onChange={setShowTerminatedStaff} />
            </div>
          ) : (
            <Input
              label="Staff member"
              value={
                selectedMember
                  ? `${selectedMember.firstName} ${selectedMember.lastName}`
                  : `${timesheetsViewer?.firstName ?? ''} ${timesheetsViewer?.lastName ?? ''}`.trim() || 'You'
              }
              readOnly
              hint="You can only submit timesheets for yourself."
            />
          )}
          <Input label="Date" type="date" value={workDate} onChange={(event) => setWorkDate(event.currentTarget.value)} />
          <Input label="Clock in" type="time" value={startTime} onChange={(event) => setStartTime(event.currentTarget.value)} />
          <Input label="Clock out" type="time" value={endTime} onChange={(event) => setEndTime(event.currentTarget.value)} />
          <Input label="Break minutes" type="number" value={breakMinutes} onChange={(event) => setBreakMinutes(event.currentTarget.value)} />
          <Select
            label="Area"
            value={area}
            onChange={(event) => setArea(event.currentTarget.value)}
            options={['Floor', 'Bar', 'Kitchen', 'Management', 'Events'].map((value) => ({ label: value, value }))}
          />
          <Select
            label="Pay method"
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.currentTarget.value as 'XERO' | 'CASH')}
            options={[
              { label: 'Xero payroll', value: 'XERO' },
              { label: 'Cash pay', value: 'CASH' }
            ]}
          />
          <Input label="Xero employee ID" value={xeroEmployeeId} onChange={(event) => setXeroEmployeeId(event.currentTarget.value)} />
          <Input label="Xero earnings rate ID" value={xeroEarningsRateId} onChange={(event) => setXeroEarningsRateId(event.currentTarget.value)} />
        </div>
        {paymentMethod === 'CASH' ? (
          <p className="subtle">Cash-pay timesheets can be approved and marked cash paid, but they are excluded from the Xero CSV export.</p>
        ) : null}
        <Textarea label="Notes" rows={3} value={notes} onChange={(event) => setNotes(event.currentTarget.value)} />
        <div className="toolbar-right">
          <Button type="button" disabled={saving} onClick={() => void submitTimesheet()}>
            {saving ? 'Saving…' : 'Submit timesheet'}
          </Button>
          <ActionFeedback
            message={messageTarget === 'submit' ? message : null}
            tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
          />
        </div>
      </>
    );
  }

  function renderGroup(group: TimesheetGroup) {
    return (
      <section key={group.id} className="timesheet-group">
        <header className="timesheet-group-head">
          <span className="timesheet-group-avatar">
            {group.member ? staffInitials(group.member) : (group.name[0] ?? 'A').toUpperCase()}
          </span>
          <div className="timesheet-group-meta">
            <strong>{group.name}</strong>
            <span className="subtle">{[group.roleTitle, group.venue].filter(Boolean).join(' · ') || 'No venue set'}</span>
          </div>
          <div className="timesheet-group-stats">
            <span>
              <strong>{group.entries.length}</strong> shift{group.entries.length === 1 ? '' : 's'}
            </span>
            <span>
              <strong>{roundHours(group.totalHours)}</strong>
            </span>
            {group.submittedIds.length ? (
              <Badge tone="info" dot>{group.submittedIds.length} to approve</Badge>
            ) : null}
            {group.approvedCount ? <Badge tone="positive">{group.approvedCount} approved</Badge> : null}
          </div>
          {isManagerView && group.submittedIds.length ? (
            <Button type="button" size="sm" disabled={saving} onClick={() => void approveGroup(group.submittedIds)}>
              Approve all
            </Button>
          ) : null}
          {isManagerView ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setReassignTargetId('');
                setReassignGroupKey((current) => (current === group.id ? null : group.id));
              }}
            >
              Reassign
            </Button>
          ) : null}
        </header>
        {isManagerView && reassignGroupKey === group.id ? (
          <div className="timesheet-reassign-bar" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', flexWrap: 'wrap' }}>
            <span className="subtle">
              Move {group.entries.length === 1 ? 'this shift' : `all ${group.entries.length} shifts`} from <strong>{group.name}</strong> to
            </span>
            <select
              aria-label={`Reassign shifts for ${group.name}`}
              value={reassignTargetId}
              onChange={(event) => setReassignTargetId(event.currentTarget.value)}
            >
              <option value="">Choose staff…</option>
              {staff
                .filter((member) => member.id !== group.member?.id)
                .slice()
                .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.firstName} {member.lastName}{member.venue ? ` · ${member.venue}` : ''}
                  </option>
                ))}
            </select>
            <Button
              type="button"
              size="sm"
              disabled={saving || !reassignTargetId}
              onClick={() => void reassignEntries(group.entries.map((entry) => entry.id), reassignTargetId)}
            >
              Move shifts
            </Button>
            <span className="subtle">Works on approved shifts too — each moved row keeps an audit note. Exported rows keep their paid hours; only the person changes.</span>
          </div>
        ) : null}
        <div className="timesheet-group-rows">
          {group.entries.map((entry) => {
            const member = group.member;
            const awardCheck = checkAwardCompliance(member);
            const clockDrift = computeClockDrift(entry, clockSessions);
            return (
              <div key={entry.id} className="timesheet-row">
                <div className="timesheet-row-when">
                  <strong>{new Date(entry.workDate).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
                  <span>{timeOf(entry.clockInAt)}–{timeOf(entry.clockOutAt)}{entry.breakMinutes ? ` · ${entry.breakMinutes}m break` : ''}</span>
                </div>
                <span className="timesheet-row-hours">{roundHours(timesheetHours(entry))}</span>
                <span className="timesheet-row-area subtle">{entry.area || '—'}</span>
                <div className="timesheet-row-badges">
                  <Badge tone={timesheetTone(entry.status)} dot>{entry.status}</Badge>
                  {entry.isLeave ? <Badge tone="info">{entry.leaveKind ?? 'Leave'}</Badge> : null}
                  <Badge tone={entry.paymentMethod === 'CASH' ? 'warning' : 'muted'}>
                    {entry.paymentMethod === 'CASH' ? (entry.cashPaidAt ? 'Cash paid' : 'Cash') : 'Xero'}
                  </Badge>
                  {awardCheck.status === 'below' ? (
                    <Badge tone="danger" dot>Award ⚠</Badge>
                  ) : null}
                  {clockDrift ? (
                    <span title={`Clock ${clockDrift.clockHours.toFixed(2)}h vs timesheet ${timesheetHours(entry).toFixed(2)}h`}>
                      <Badge tone={clockDrift.severity === 'danger' ? 'danger' : 'warning'} dot>
                        Drift {clockDrift.driftHours >= 0 ? '+' : ''}{clockDrift.driftHours.toFixed(1)}h
                      </Badge>
                    </span>
                  ) : null}
                </div>
                <div className="timesheet-row-actions">
                  {isManagerView && (entry.status === 'SUBMITTED' || entry.status === 'REJECTED') ? (
                    <Button type="button" size="sm" disabled={saving} onClick={() => void approve(entry.id)}>
                      Approve
                    </Button>
                  ) : null}
                  {isManagerView && entry.status === 'APPROVED' && entry.paymentMethod === 'CASH' && !entry.cashPaidAt ? (
                    <Button type="button" size="sm" disabled={saving} onClick={() => void markCashPaid(entry.id)}>
                      Cash paid
                    </Button>
                  ) : null}
                  {isManagerView && entry.status !== 'EXPORTED' ? (
                    <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => openEdit(entry)}>
                      Edit
                    </Button>
                  ) : null}
                  {isManagerView && entry.status === 'EXPORTED' ? (
                    <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void unexportEntry(entry)}>
                      Unlock re-push
                    </Button>
                  ) : null}
                  {isManagerView && entry.status !== 'EXPORTED' ? (
                    <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void reject(entry.id)}>
                      Reject
                    </Button>
                  ) : null}
                </div>
                {awardCheck.status === 'below' ? (
                  <span className="timesheet-row-note award-compliance-warning" role="alert">
                    ⚠ Pay rate ${(member?.payRateCents ?? 0) / 100}/hr below{' '}
                    {awardCheck.employmentType === 'CASUAL' ? 'casual loaded' : 'ordinary'} minimum ${awardCheck.minimumCents / 100}/hr ({awardCheck.classificationLabel})
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Payroll"
        title="Timesheets"
        description="Staff submit worked hours, managers approve them, then approved hours push straight into Xero as draft timesheets (or export a Xero-ready CSV)."
      />

      <div className="stats-grid">
        <StatCard label="Submitted" value={submittedCount} hint="Awaiting approval" loading={loading} />
        <StatCard label="Approved" value={approvedCount} hint="Ready for Xero" loading={loading} />
        <StatCard label="Approved hours" value={roundHours(approvedHours)} hint={formatRange(weekStart, addDays(weekEnd, -1))} loading={loading} />
      </div>

      <div className="timesheet-page-toolbar">
        <Button
          type="button"
          onClick={() => {
            setMessage(null);
            setMessageTarget(null);
            setShowSubmitModal(true);
          }}
        >
          + Submit new timesheet
        </Button>
        {isManagerView ? (
          <div className="toolbar-right">
            <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void importFromDeputy()}>
              Import from Deputy
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void importFromXero()}>
              Import from Xero
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void exportXero(false)}>
              Preview CSV
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void exportXero(true)}>
              Export CSV
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void pushToXero(true)}>
              {pushSelection.length ? `Preview ${pushSelection.length}` : 'Preview push'}
            </Button>
            <Button type="button" size="sm" disabled={saving} onClick={() => void pushToXero()}>
              {pushSelection.length ? `Push ${pushSelection.length} to Xero` : 'Push all to Xero'}
            </Button>
          </div>
        ) : null}
      </div>
      {isManagerView && (messageTarget === 'import-xero' || messageTarget === 'import-deputy') && message ? (
        <ActionFeedback message={message} tone={message.includes('Could') ? 'error' : 'success'} />
      ) : null}

      {/* Week selector — same editorial style as the roster board, sitting
          between the toolbar and the approval queue. */}
      <div className="alma-roster-header alma-roster-header--tight">
        <div className="alma-roster-header-titles">
          <div className="alma-roster-title-row">
            <span className="alma-roster-title">Week of</span>
            <span className="alma-roster-title is-italic">{formatRange(weekStart, addDays(weekEnd, -1))}</span>
            <div className="alma-roster-weeknav">
              <button
                type="button"
                className="alma-roster-weeknav-btn"
                aria-label="Previous week"
                onClick={() => { setRangeMode('week'); setWeekStart(addDays(weekStart, -7)); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="15 6 9 12 15 18" />
                </svg>
              </button>
              <button
                type="button"
                className="alma-roster-weeknav-btn"
                aria-label="Next week"
                onClick={() => { setRangeMode('week'); setWeekStart(addDays(weekStart, 7)); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
              <button
                type="button"
                className="alma-roster-weeknav-btn alma-roster-weeknav-btn--text"
                onClick={() => { setRangeMode('week'); setWeekStart(startOfWeek(new Date())); }}
              >
                This week
              </button>
            </div>
          </div>
        </div>
      </div>

      {(messageTarget === 'preview' || messageTarget === 'export' || messageTarget === 'push') && message ? (
        <p className={message.includes('Could') || message.includes('failed') ? 'error-text' : 'subtle'}>{message}</p>
      ) : null}

      {/* Per-employee push outcome. A preview and a real push produce the same
          shape, so a manager can read the list, fix the failures, and run it
          again without guessing which name the summary was talking about. */}
      {pushResult ? (
        <div className="ts-push-result">
          <div className="ts-push-result-head">
            <strong>
              {pushResult.rows.length === 0
                ? 'Nothing to push'
                : pushResult.preview
                  ? 'Preview — nothing sent to Xero yet'
                  : 'Pushed to Xero'}
            </strong>
            <span className="subtle">
              {pushResult.rows.length === 0
                ? (message ?? 'No approved timesheets matched.')
                : `${pushResult.preview ? `${pushResult.pushed} ready` : `${pushResult.pushed} sent`}${
                    pushResult.failed ? ` · ${pushResult.failed} failed` : ''
                  }${pushResult.skipped ? ` · ${pushResult.skipped} skipped` : ''}`}
            </span>
            <button type="button" className="ts-push-result-close" onClick={() => setPushResult(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
          <ul className="ts-push-result-list">
            {pushResult.rows.map((row, index) => (
              <li key={`${row.employee}-${row.periodStart ?? index}`} className={`is-${row.status}`}>
                <span className="ts-push-result-name">{row.employee}</span>
                <span className="ts-push-result-period">
                  {row.periodStart ? `${row.periodStart} → ${row.periodEnd}` : '—'}
                </span>
                <span className="ts-push-result-message">{row.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Roster & pay Turn 2: week review table — at-a-glance rostered vs worked
          per staff member, with per-staff and bulk approval (existing endpoints). */}
      {!loading && timesheets.length > 0 ? (
        <div className={`ts-review ${reviewOpen ? '' : 'is-collapsed'}`}>
          <div className="pay-section-head">
            <button
              type="button"
              className="ts-review-toggle"
              aria-expanded={reviewOpen}
              onClick={() => setReviewOpen((open) => !open)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <span className="sr-only">{reviewOpen ? 'Collapse week review' : 'Expand week review'}</span>
            </button>
            <div className="pay-section-head-text">
              <h3 className="pay-section-title">Week review</h3>
              <p className="pay-section-note">
                {overallCounts.submitted > 0
                  ? `${overallCounts.submitted} shift${overallCounts.submitted === 1 ? ' needs' : 's need'} a look before pay runs Tuesday.`
                  : 'All clear.'}
                {/* Collapsed, the totals are the only thing worth showing. */}
                {reviewOpen ? null : ` · ${roundHours(allGroups.reduce((sum, group) => sum + group.totalHours, 0))} worked across ${allGroups.length} staff.`}
              </p>
            </div>
            {isManagerView && overallCounts.submitted > 0 ? (
              <button
                type="button"
                className="pay-head-approve-btn"
                disabled={saving}
                onClick={() =>
                  void approveGroup(
                    timesheets
                      .filter((entry) => entry.status === 'SUBMITTED' || entry.status === 'REJECTED')
                      .map((entry) => entry.id)
                  )
                }
              >
                Approve {overallCounts.submitted} flagged
              </button>
            ) : null}
          </div>
          <div className="ts-review-card" hidden={!reviewOpen}>
            <table className="ts-review-table">
              <thead>
                <tr>
                  {isManagerView ? (
                    <th className="ts-review-pick">
                      <input
                        type="checkbox"
                        aria-label="Select all staff for the Xero push"
                        checked={pushSelection.length > 0 && pushSelection.length === allGroups.length}
                        ref={(node) => {
                          // Partial selection reads as indeterminate, not unchecked —
                          // an unchecked box next to five ticked rows is a lie.
                          if (node) node.indeterminate = pushSelection.length > 0 && pushSelection.length < allGroups.length;
                        }}
                        onChange={(event) =>
                          setPushSelection(event.currentTarget.checked ? allGroups.map((group) => group.id) : [])
                        }
                      />
                    </th>
                  ) : null}
                  <th>Staff</th>
                  <th className="is-num">Rostered</th>
                  <th className="is-num">Worked</th>
                  <th className="is-num">Variance</th>
                  <th>Flag</th>
                  <th className="is-status">Status</th>
                </tr>
              </thead>
              <tbody>
                {allGroups.map((group) => {
                  const rostered = rosteredHoursByStaff.get(group.id);
                  const worked = group.totalHours;
                  const variance = rostered === undefined ? null : worked - rostered;
                  const drift = group.entries
                    .map((entry) => computeClockDrift(entry, clockSessions))
                    .find((result) => result && result.severity !== 'ok');
                  const award = checkAwardCompliance(group.member);
                  const flag = drift
                    ? `Drift ${drift.driftHours >= 0 ? '+' : ''}${drift.driftHours.toFixed(1)}h`
                    : award.status === 'below'
                      ? 'Award rate'
                      : group.submittedIds.length
                        ? 'Needs review'
                        : null;
                  const restingStatus = group.entries[0]?.status ?? '';
                  return (
                    <tr key={group.id} className={pushSelection.includes(group.id) ? 'is-picked' : undefined}>
                      {isManagerView ? (
                        <td className="ts-review-pick">
                          <input
                            type="checkbox"
                            aria-label={`Include ${group.name} in the Xero push`}
                            checked={pushSelection.includes(group.id)}
                            onChange={(event) => {
                              // Read `checked` before the updater runs: React
                              // nulls currentTarget once the handler returns,
                              // and a functional setState executes after that.
                              const { checked } = event.currentTarget;
                              setPushSelection((current) =>
                                checked ? [...current, group.id] : current.filter((id) => id !== group.id)
                              );
                            }}
                          />
                        </td>
                      ) : null}
                      <td>
                        <span className="ts-review-staff" style={areaStyle(group.roleTitle || '')}>
                          <span className="ts-review-avatar" aria-hidden>
                            {group.member ? staffInitials(group.member) : (group.name[0] ?? 'A').toUpperCase()}
                          </span>
                          <span className="ts-review-who">
                            <strong>{group.name}</strong>
                            <small>{[group.roleTitle, group.venue].filter(Boolean).join(' · ') || 'No venue set'}</small>
                          </span>
                        </span>
                      </td>
                      <td className="is-num ts-review-rostered">{rostered === undefined ? '—' : roundHours(rostered)}</td>
                      <td className="is-num ts-review-worked">{roundHours(worked)}</td>
                      <td
                        className={`is-num ts-review-variance ${
                          variance === null || Math.abs(variance) < 0.05 ? 'is-zero' : variance > 0 ? 'is-pos' : 'is-neg'
                        }`}
                      >
                        {variance === null
                          ? '—'
                          : Math.abs(variance) < 0.05
                            ? '0.0'
                            : `${variance > 0 ? '+' : '-'}${Math.abs(variance).toFixed(1)}`}
                      </td>
                      <td className="ts-review-flagcell">
                        {flag ? (
                          <span className="ts-review-flag">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                              <circle cx="12" cy="12" r="9" />
                              <polyline points="12 7 12 12 15.5 14" />
                            </svg>
                            {flag}
                          </span>
                        ) : (
                          <span className="ts-review-noflag">—</span>
                        )}
                      </td>
                      <td className="is-status">
                        {isManagerView && group.submittedIds.length ? (
                          <button
                            type="button"
                            className="ts-approve-btn"
                            disabled={saving}
                            onClick={() => void approveGroup(group.submittedIds)}
                          >
                            Approve
                          </button>
                        ) : group.submittedIds.length ? (
                          <span className="ts-status-pill is-pending">Submitted</span>
                        ) : group.approvedCount ? (
                          <span className="ts-status-pill is-approved">Approved</span>
                        ) : (
                          <span className="ts-status-pill is-neutral">
                            {restingStatus ? restingStatus.charAt(0) + restingStatus.slice(1).toLowerCase() : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {(() => {
                  const totals = allGroups.reduce(
                    (acc, group) => {
                      const rostered = rosteredHoursByStaff.get(group.id);
                      acc.worked += group.totalHours;
                      if (rostered !== undefined) {
                        acc.rostered += rostered;
                        acc.variance += group.totalHours - rostered;
                        acc.hasRostered = true;
                      }
                      return acc;
                    },
                    { rostered: 0, worked: 0, variance: 0, hasRostered: false }
                  );
                  return (
                    <tr>
                      {isManagerView ? <td className="ts-review-pick" /> : null}
                      <td className="ts-review-total-label">Week total</td>
                      <td className="is-num ts-review-rostered">{totals.hasRostered ? roundHours(totals.rostered) : '—'}</td>
                      <td className="is-num ts-review-worked">{roundHours(totals.worked)}</td>
                      <td
                        className={`is-num ts-review-variance ${
                          !totals.hasRostered || Math.abs(totals.variance) < 0.05 ? 'is-zero' : totals.variance > 0 ? 'is-pos' : 'is-neg'
                        }`}
                      >
                        {!totals.hasRostered
                          ? '—'
                          : Math.abs(totals.variance) < 0.05
                            ? '0.0'
                            : `${totals.variance > 0 ? '+' : '-'}${Math.abs(totals.variance).toFixed(1)}`}
                      </td>
                      <td />
                      <td />
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          </div>
        </div>
      ) : null}

      {editEntry ? (
        <div className="timesheet-modal-overlay" role="dialog" aria-modal="true" onClick={() => setEditEntry(null)}>
          <div className="timesheet-modal" onClick={(event) => event.stopPropagation()}>
            <header className="timesheet-modal-head">
              <strong>
                Adjust — {editEntry.staffProfile ? `${editEntry.staffProfile.firstName} ${editEntry.staffProfile.lastName}` : 'timesheet'}
              </strong>
              <button type="button" className="timesheet-modal-close" aria-label="Close" onClick={() => setEditEntry(null)}>
                ×
              </button>
            </header>
            <div className="timesheet-modal-body">
              <div className="form-grid">
                <Input label="Date worked" type="date" value={editForm.workDate} onChange={(event) => setEditForm({ ...editForm, workDate: event.currentTarget.value })} hint="The day the shift STARTED — weekend rates follow this." />
                <Input label="Clock in" type="time" value={editForm.start} onChange={(event) => setEditForm({ ...editForm, start: event.currentTarget.value })} />
                <Input label="Clock out" type="time" value={editForm.end} onChange={(event) => setEditForm({ ...editForm, end: event.currentTarget.value })} hint="An end at or before the start rolls to the next day." />
                <Input label="Break minutes" type="number" value={editForm.breakMinutes} onChange={(event) => setEditForm({ ...editForm, breakMinutes: event.currentTarget.value })} hint="Unpaid break, taken off the paid hours." />
                <Select label="Venue" value={editForm.venue} onChange={(event) => setEditForm({ ...editForm, venue: event.currentTarget.value })} options={[{ label: '(none)', value: '' }, { label: 'St Alma', value: 'St Alma' }, { label: 'Alma Avalon', value: 'Alma Avalon' }]} hint="Decides which company's payroll pays the shift." />
                <Input label="Area" value={editForm.area} onChange={(event) => setEditForm({ ...editForm, area: event.currentTarget.value })} />
                <Input label="Notes" value={editForm.notes} onChange={(event) => setEditForm({ ...editForm, notes: event.currentTarget.value })} />
              </div>
              {editEntry.status === 'APPROVED' ? (
                <p className="subtle">This shift is already approved — your change takes effect as approved, no re-approval dance.</p>
              ) : null}
              <div className="toolbar-right">
                <Button type="button" variant="secondary" onClick={() => setEditEntry(null)}>Cancel</Button>
                <Button type="button" disabled={saving} onClick={() => void saveEdit()}>Save adjustment</Button>
                <ActionFeedback message={messageTarget === `edit:${editEntry.id}` ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showSubmitModal ? (
        <div className="timesheet-modal-overlay" role="dialog" aria-modal="true" onClick={() => setShowSubmitModal(false)}>
          <div className="timesheet-modal" onClick={(event) => event.stopPropagation()}>
            <header className="timesheet-modal-head">
              <strong>Submit new timesheet</strong>
              <button type="button" className="timesheet-modal-close" aria-label="Close" onClick={() => setShowSubmitModal(false)}>
                ×
              </button>
            </header>
            <div className="timesheet-modal-body">{renderSubmitFields()}</div>
          </div>
        </div>
      ) : null}

      <div className="timesheet-board">
        <Card title="Approval queue" subtitle="Review and approve submitted hours by employee or location">
          <div className="roster-week-controls" aria-label="Timesheet week controls">
            <Select
              label="Range"
              value={rangeMode}
              onChange={(event) => {
                const value = event.currentTarget.value as 'week' | '30' | '90';
                setRangeMode(value);
              }}
              options={[
                { label: 'By week', value: 'week' },
                { label: 'Last 30 days', value: '30' },
                { label: 'Last 90 days', value: '90' }
              ]}
            />
            {rangeMode !== 'week' ? (
              <strong>{formatRange(rangeStart, addDays(rangeEnd, -1))}</strong>
            ) : null}
            <Select
              label="Venue"
              value={venueFilter}
              onChange={(event) => setVenueFilter(event.currentTarget.value)}
              options={venueOptions}
            />
            <Select
              label="Status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.currentTarget.value as typeof statusFilter)}
              options={['all', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'EXPORTED'].map((value) => ({ label: value, value }))}
            />
          </div>

          {message && (messageTarget === null || messageTarget === 'approve-group' || /^(approve|reject|cash):/.test(messageTarget)) ? (
            <p className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</p>
          ) : null}

          {loading ? <Spinner label="Loading timesheets…" /> : null}
          {!loading && timesheets.length === 0 ? (
            <EmptyState title="No timesheets yet" description="Submitted timesheets for this period will appear here." />
          ) : null}

          {!loading && timesheets.length > 0 ? (
            <div className="timesheet-explorer">
              <aside className="timesheet-explorer-rail" aria-label="Timesheet filters">
                <button
                  type="button"
                  className={`ts-rail-item ${selection.type === 'all' ? 'is-active' : ''}`}
                  onClick={() => setSelection({ type: 'all' })}
                >
                  <span className="ts-rail-name">All timesheets</span>
                  <span className="ts-rail-counts">
                    {overallCounts.approved} Approved · {overallCounts.submitted} Submitted
                  </span>
                </button>
                {venueSummaries.length > 1 ? (
                  <div className="ts-rail-section">
                    <span className="ts-rail-heading">Locations</span>
                    {venueSummaries.map((summary) => (
                      <button
                        key={summary.venue}
                        type="button"
                        className={`ts-rail-item ${selection.type === 'venue' && selection.venue === summary.venue ? 'is-active' : ''}`}
                        onClick={() => setSelection({ type: 'venue', venue: summary.venue })}
                      >
                        <span className="ts-rail-name">{summary.venue}</span>
                        <span className="ts-rail-counts">
                          {summary.approved} Approved · {summary.submitted} Submitted
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="ts-rail-section">
                  <span className="ts-rail-heading">Staff</span>
                  {allGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className={`ts-rail-item ts-rail-staff ${selection.type === 'staff' && selection.id === group.id ? 'is-active' : ''} ${group.submittedIds.length ? 'has-pending' : ''}`}
                      title={`${group.name} — ${group.approvedCount} approved, ${group.submittedIds.length} submitted`}
                      onClick={() => setSelection({ type: 'staff', id: group.id })}
                    >
                      <span className="ts-rail-avatar">
                        {group.member ? staffInitials(group.member) : (group.name[0] ?? 'A').toUpperCase()}
                      </span>
                      <span className="ts-rail-staff-meta">
                        <span className="ts-rail-name">{group.name}</span>
                        <span className="ts-rail-counts">
                          {group.approvedCount} Approved · {group.submittedIds.length} Submitted
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="timesheet-explorer-detail">
                <div className="timesheet-explorer-detail-head">
                  <strong>{detailTitle}</strong>
                  {selection.type !== 'all' ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSelection({ type: 'all' })}>
                      View all
                    </Button>
                  ) : null}
                </div>
                {visibleGroups.length === 0 ? (
                  <EmptyState title="No timesheets" description="Nothing matches this selection for the chosen period." />
                ) : null}
                <div className="timesheet-groups">{visibleGroups.map((group) => renderGroup(group))}</div>
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

type ClockDriftResult = {
  driftHours: number;
  clockHours: number;
  clockInAt: string;
  clockOutAt: string | null;
  severity: 'ok' | 'warning' | 'danger';
};

function computeClockDrift(timesheet: Timesheet, clockSessions: StaffClockSession[]): ClockDriftResult | null {
  // Match clock sessions where the staff member is the same and the clock-in
  // falls on the same calendar date as the timesheet's workDate.
  const tsDate = new Date(timesheet.workDate);
  const dayKey = tsDate.toISOString().slice(0, 10);
  const candidates = clockSessions.filter((s) =>
    s.staffProfileId === timesheet.staffProfileId &&
    s.clockOutAt !== null &&
    s.clockInAt.slice(0, 10) === dayKey
  );
  if (candidates.length === 0) return null;

  // If there are multiple, pick the one closest to the timesheet's clock-in
  const tsClockIn = new Date(timesheet.clockInAt).getTime();
  candidates.sort((a, b) =>
    Math.abs(new Date(a.clockInAt).getTime() - tsClockIn) -
    Math.abs(new Date(b.clockInAt).getTime() - tsClockIn)
  );
  const match = candidates[0]!;

  const clockOutMs = new Date(match.clockOutAt!).getTime();
  const clockInMs = new Date(match.clockInAt).getTime();
  const clockHours = (clockOutMs - clockInMs) / 1000 / 60 / 60 - (match.accumulatedBreakMinutes / 60);
  const tsHours = timesheetHours(timesheet);
  const driftHours = tsHours - clockHours;
  const absDrift = Math.abs(driftHours);
  const severity: 'ok' | 'warning' | 'danger' =
    absDrift < 0.1 ? 'ok' : absDrift < 0.5 ? 'warning' : 'danger';
  // Don't surface drift if it's negligible
  if (severity === 'ok') return null;
  return { driftHours, clockHours, clockInAt: match.clockInAt, clockOutAt: match.clockOutAt, severity };
}

type AwardComplianceResult =
  | { status: 'compliant'; minimumCents: number; employmentType: string; classificationLabel: string }
  | { status: 'below'; minimumCents: number; employmentType: string; classificationLabel: string }
  | { status: 'unknown' };

function checkAwardCompliance(member: StaffProfile | undefined): AwardComplianceResult {
  if (!member?.payRateCents) return { status: 'unknown' };
  if (!member.payProfile) return { status: 'unknown' };
  const pp = member.payProfile;
  const isCasual = pp.employmentType === 'CASUAL';
  const minimumCents = isCasual && pp.casualLoadedHourlyRateCents
    ? pp.casualLoadedHourlyRateCents
    : pp.ordinaryHourlyRateCents;
  const actualCents = member.payRateCents;
  const classificationLabel = pp.awardClassification.replace(/-/g, ' ');
  if (actualCents < minimumCents) {
    return { status: 'below', minimumCents, employmentType: pp.employmentType, classificationLabel };
  }
  return { status: 'compliant', minimumCents, employmentType: pp.employmentType, classificationLabel };
}

function timesheetTone(status: Timesheet['status']) {
  switch (status) {
    case 'APPROVED':
    case 'EXPORTED':
      return 'positive';
    case 'REJECTED':
      return 'danger';
    case 'SUBMITTED':
      return 'warning';
    case 'DRAFT':
    default:
      return 'muted';
  }
}
