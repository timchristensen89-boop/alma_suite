// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHubTabBadge } from '../components/HubTabs';
import type { StaffProfile, StaffLeaveRequest, StaffLeaveStatus, StaffLeaveType } from '@alma/shared';
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
import { startOfWeek, addDays, toDateInput, formatRange, uniqueValues } from '../lib/datetime';
import {
  LEAVE_TYPE_OPTIONS,
  LEAVE_STATUS_OPTIONS,
  staffInitials,
  sortStaffForSelect,
  leaveStatusTone,
  leaveTypeLabel,
  leaveStatusLabel,
  leaveOverlapsDay,
  weekDays,
  areaStyle
} from './shared';

type LeaveDraft = {
  staffProfileId: string;
  type: StaffLeaveType;
  status: StaffLeaveStatus;
  startDate: string;
  endDate: string;
  notes: string;
  managerNote: string;
};

function leaveDraftFor(staff: StaffProfile[]): LeaveDraft {
  const today = toDateInput(new Date());
  return {
    staffProfileId: staff.find((member) => member.employmentStatus !== 'ARCHIVED')?.id ?? '',
    type: 'ANNUAL',
    status: 'APPROVED',
    startDate: today,
    endDate: today,
    notes: '',
    managerNote: ''
  };
}

// Roster & pay Turn 2: "6 days · 2 weeks out" meta line for leave request cards.
function leaveRequestMeta(item: StaffLeaveRequest) {
  const start = new Date(item.startDate);
  const end = new Date(item.endDate);
  const today = new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const lead = Math.round((start.getTime() - today.getTime()) / 86400000);
  let when: string;
  if (lead > 13) when = `${Math.round(lead / 7)} weeks out`;
  else if (lead > 1) when = `${lead} days out`;
  else if (lead === 1) when = 'starts tomorrow';
  else if (lead === 0) when = 'starts today';
  else if (end.getTime() >= today.getTime()) when = 'away now';
  else when = 'in the past';
  return `${days} day${days === 1 ? '' : 's'} · ${when}`;
}

// Leave-type pill accent (annual=info, sick=danger, personal=warn, unpaid/other=neutral).
function leaveTypePillClass(type: StaffLeaveType) {
  if (type === 'ANNUAL') return 'is-annual';
  if (type === 'SICK') return 'is-sick';
  if (type === 'PERSONAL') return 'is-personal';
  return 'is-neutral';
}

export function LeaveCalendarPage({ staff }: { staff: StaffProfile[] }) {
  const { user } = useAuth();
  const [monthStart, setMonthStart] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [leave, setLeave] = useState<StaffLeaveRequest[]>([]);
  const [draft, setDraft] = useState<LeaveDraft>(() => leaveDraftFor(staff));
  const [venueFilter, setVenueFilter] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(() => toDateInput(new Date()));
  // Optional manager note captured per pending request when approving/declining.
  const [leaveNotes, setLeaveNotes] = useState<Record<string, string>>({});

  const activeStaff = staff.filter((member) => member.employmentStatus !== 'ARCHIVED');
  const venueOptions = [
    { label: 'All permitted venues', value: '' },
    ...uniqueValues(activeStaff.map((member) => member.venue).filter(Boolean) as string[]).map((venue) => ({ label: venue, value: venue }))
  ];
  const staffOptions = [
    { label: 'All staff', value: '' },
    ...sortStaffForSelect(activeStaff).map((member) => ({
      label: `${member.firstName} ${member.lastName}`,
      value: member.id
    }))
  ];
  const recordStaffOptions = [
    { label: 'Choose staff', value: '' },
    ...sortStaffForSelect(activeStaff).map((member) => ({
      label: `${member.firstName} ${member.lastName} · ${member.venue || 'No venue'}`,
      value: member.id
    }))
  ];
  const calendarStart = useMemo(() => startOfWeek(monthStart), [monthStart]);
  const calendarDays = useMemo(() => weekDays(calendarStart, 42), [calendarStart]);
  const calendarEnd = useMemo(() => addDays(calendarStart, 42), [calendarStart]);
  const approvedCount = leave.filter((item) => item.status === 'APPROVED').length;
  const pendingCount = leave.filter((item) => item.status === 'PENDING').length;
  const pendingLeave = leave.filter((item) => item.status === 'PENDING');
  const resolvedLeave = leave.filter((item) => item.status !== 'PENDING');
  // Roster & pay Turn 2: surface the pending count on the hub's Leave tab.
  useHubTabBadge('/leave', pendingCount);
  const selectedDayDate = useMemo(() => new Date(`${selectedDay}T00:00:00`), [selectedDay]);
  const selectedDayLeave = leave.filter((item) => leaveOverlapsDay(item, selectedDayDate));

  const loadLeave = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({
        start: toDateInput(calendarStart),
        end: toDateInput(calendarEnd)
      });
      if (venueFilter) params.set('venue', venueFilter);
      if (staffFilter) params.set('staffProfileId', staffFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('type', typeFilter);
      setLeave(await api<StaffLeaveRequest[]>(`/api/staff/leave?${params.toString()}`));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load leave calendar.');
    } finally {
      setLoading(false);
    }
  }, [calendarEnd, calendarStart, staffFilter, statusFilter, typeFilter, venueFilter]);

  useEffect(() => {
    void loadLeave();
  }, [loadLeave]);

  useEffect(() => {
    if (!draft.staffProfileId && activeStaff[0]) {
      setDraft((current) => ({ ...current, staffProfileId: activeStaff[0].id }));
    }
  }, [activeStaff, draft.staffProfileId]);

  function updateDraft<K extends keyof LeaveDraft>(key: K, value: LeaveDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function selectLeaveDay(day: Date) {
    const dayKey = toDateInput(day);
    setSelectedDay(dayKey);
    setDraft((current) => ({
      ...current,
      staffProfileId: current.staffProfileId || staffFilter || activeStaff[0]?.id || '',
      startDate: dayKey,
      endDate: dayKey
    }));
  }

  function changeLeaveMonth(offset: -1 | 1) {
    const next = new Date(monthStart.getFullYear(), monthStart.getMonth() + offset, 1);
    setMonthStart(next);
    selectLeaveDay(next);
  }

  function jumpToCurrentLeaveMonth() {
    const today = new Date();
    const next = new Date(today.getFullYear(), today.getMonth(), 1);
    setMonthStart(next);
    selectLeaveDay(today);
  }

  async function saveLeave() {
    setMessageTarget('leave-save');
    if (!draft.staffProfileId) {
      setMessage('Choose a staff member before recording leave.');
      return;
    }
    if (!draft.startDate || !draft.endDate || draft.endDate < draft.startDate) {
      setMessage('Use a valid date range for leave.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await api<StaffLeaveRequest>('/api/staff/leave', {
        method: 'POST',
        body: JSON.stringify(draft)
      });
      setDraft({
        ...leaveDraftFor(activeStaff),
        staffProfileId: draft.staffProfileId,
        startDate: selectedDay,
        endDate: selectedDay
      });
      setMessage('Leave recorded.');
      await loadLeave();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not record leave.');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(item: StaffLeaveRequest, status: StaffLeaveStatus) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`leave:${item.id}:${status}`);
    const note = leaveNotes[item.id]?.trim();
    try {
      await api<StaffLeaveRequest>(`/api/staff/leave/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(note ? { managerNote: note } : {}) })
      });
      setMessage(`Leave ${status.toLowerCase()}.`);
      setLeaveNotes((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await loadLeave();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update leave.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack leave-page">
      <PageHeader
        eyebrow="Leave calendar"
        title="Staff leave"
        description="Record, approve and review pending or approved staff leave across your permitted venues."
      />

      <div className="stats-grid">
        <StatCard label="Leave records" value={leave.length} hint="Visible range" loading={loading} />
        <StatCard label="Approved" value={approvedCount} hint="Roster-impacting" loading={loading} />
        <StatCard label="Pending" value={pendingCount} hint="Needs review" loading={loading} />
        <StatCard label="Staff in scope" value={activeStaff.length} hint={user?.venue || 'Permitted venues'} loading={loading} />
      </div>

      {message && !messageTarget ? <p className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</p> : null}

      <div className="leave-board-layout">
        <Card className="leave-calendar-card" title="Month view" subtitle="Click any day to add leave or review who is already away.">
          <div className="roster-week-controls leave-month-controls">
            <Button type="button" variant="secondary" size="sm" onClick={() => changeLeaveMonth(-1)}>
              Previous
            </Button>
            <strong>{monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
            <Button type="button" variant="secondary" size="sm" onClick={() => changeLeaveMonth(1)}>
              Next
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={jumpToCurrentLeaveMonth}>
              Today
            </Button>
          </div>
          <div className="leave-calendar-grid" role="grid" aria-label="Staff leave calendar">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <strong key={day} className="leave-calendar-heading">{day}</strong>
            ))}
            {calendarDays.map((day) => {
              const dayKey = toDateInput(day);
              const dayLeave = leave.filter((item) => leaveOverlapsDay(item, day));
              const outsideMonth = day.getMonth() !== monthStart.getMonth();
              const selected = dayKey === selectedDay;
              return (
                <button
                  key={dayKey}
                  type="button"
                  className={`leave-calendar-day${outsideMonth ? ' is-muted' : ''}${selected ? ' is-selected' : ''}${dayLeave.length ? ' has-leave' : ''}`}
                  aria-pressed={selected}
                  onClick={() => selectLeaveDay(day)}
                >
                  <span className="leave-calendar-date">{day.getDate()}</span>
                  {dayLeave.slice(0, 3).map((item) => (
                    <span key={item.id} className={`leave-pill is-${item.status.toLowerCase()}`}>
                      {item.staffProfile?.firstName ?? 'Staff'} · {leaveStatusLabel(item.status)}
                    </span>
                  ))}
                  {dayLeave.length > 3 ? <small className="subtle">+{dayLeave.length - 3} more</small> : null}
                  {dayLeave.length === 0 ? <small className="leave-day-empty">Click to add</small> : null}
                </button>
              );
            })}
          </div>
        </Card>

        <aside className="leave-day-panel">
          <Card
            title={selectedDayDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            subtitle={`${selectedDayLeave.length} leave record${selectedDayLeave.length === 1 ? '' : 's'} on this day`}
          >
            {selectedDayLeave.length ? (
              <div className="leave-day-list">
                {selectedDayLeave.map((item) => (
                  <div key={item.id} className="leave-day-item">
                    <span>
                      <strong>{item.staffProfile ? `${item.staffProfile.firstName} ${item.staffProfile.lastName}` : 'Staff member'}</strong>
                      <small>{leaveTypeLabel(item.type)} · {formatRange(new Date(item.startDate), new Date(item.endDate))}</small>
                    </span>
                    <Badge tone={leaveStatusTone(item.status)}>{leaveStatusLabel(item.status)}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No leave on this day" description="Use the form below to record leave for this date." />
            )}
          </Card>

          <Card title="Add leave" subtitle="The selected calendar day is prefilled. Extend the end date for longer leave.">
            <form
              className="staff-profile-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveLeave();
              }}
            >
              <Select label="Staff member" value={draft.staffProfileId} onChange={(event) => updateDraft('staffProfileId', event.currentTarget.value)} options={recordStaffOptions} />
              <div className="form-grid two">
                <Select label="Leave type" value={draft.type} onChange={(event) => updateDraft('type', event.currentTarget.value as StaffLeaveType)} options={LEAVE_TYPE_OPTIONS} />
                <Select label="Status" value={draft.status} onChange={(event) => updateDraft('status', event.currentTarget.value as StaffLeaveStatus)} options={LEAVE_STATUS_OPTIONS} />
                <Input label="Start date" type="date" value={draft.startDate} onChange={(event) => updateDraft('startDate', event.currentTarget.value)} />
                <Input label="End date" type="date" value={draft.endDate} onChange={(event) => updateDraft('endDate', event.currentTarget.value)} />
              </div>
              <Textarea label="Staff note" rows={2} value={draft.notes} onChange={(event) => updateDraft('notes', event.currentTarget.value)} />
              <Textarea label="Manager note" rows={2} value={draft.managerNote} onChange={(event) => updateDraft('managerNote', event.currentTarget.value)} />
              <div className="toolbar-right">
                <Button type="submit" disabled={saving || !draft.staffProfileId}>{saving ? 'Saving…' : 'Record leave'}</Button>
                <ActionFeedback
                  message={messageTarget === 'leave-save' ? message : null}
                  tone={message?.includes('Could') || message?.includes('Choose') || message?.includes('valid') ? 'error' : 'success'}
                />
              </div>
            </form>
          </Card>

          <Card title="Filters" subtitle="Narrow the board without changing saved records.">
            <div className="staff-profile-form">
              <Select label="Venue" value={venueFilter} onChange={(event) => setVenueFilter(event.currentTarget.value)} options={venueOptions} />
              <Select label="Staff member" value={staffFilter} onChange={(event) => setStaffFilter(event.currentTarget.value)} options={staffOptions} />
              <Select label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)} options={[{ label: 'All statuses', value: '' }, ...LEAVE_STATUS_OPTIONS]} />
              <Select label="Leave type" value={typeFilter} onChange={(event) => setTypeFilter(event.currentTarget.value)} options={[{ label: 'All leave types', value: '' }, ...LEAVE_TYPE_OPTIONS]} />
              <Button type="button" variant="secondary" disabled={loading} onClick={() => void loadLeave()}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
          </Card>
        </aside>
      </div>

      <Card title="Leave requests" subtitle="Review pending requests first — resolved history stays below.">
        {loading ? <Spinner label="Loading leave…" /> : null}
        {!loading && leave.length === 0 ? (
          <EmptyState title="No leave in this range" description="Record leave when a staff member is away, or adjust the filters." />
        ) : null}
        {leave.length > 0 ? (
          <div className="leave-request-groups">
            {(
              [
                { key: 'pending', label: `Pending · ${pendingLeave.length}`, items: pendingLeave },
                { key: 'resolved', label: 'Resolved', items: resolvedLeave }
              ] as const
            ).map((group) =>
              group.key === 'resolved' && group.items.length === 0 ? null : (
                <section key={group.key} className="leave-request-group">
                  <h4 className="leave-request-group-label">{group.label}</h4>
                  {group.key === 'pending' && group.items.length === 0 ? (
                    <div className="leave-request-empty">All caught up. Nothing waiting on you.</div>
                  ) : null}
                  {group.items.map((item) => {
                    const member = item.staffProfile;
                    const resolved = item.status !== 'PENDING';
                    return (
                      <article
                        key={item.id}
                        className={`leave-request-card${resolved ? ` is-resolved is-${item.status.toLowerCase()}` : ''}`}
                        style={areaStyle(member?.roleTitle ?? '')}
                      >
                        <span className="leave-request-avatar" aria-hidden>
                          {member ? staffInitials(member) : 'SP'}
                        </span>
                        <div className="leave-request-main">
                          <div className="leave-request-topline">
                            <strong>{member ? `${member.firstName} ${member.lastName}` : 'Staff member'}</strong>
                            <span className={`leave-type-pill ${leaveTypePillClass(item.type)}`}>{leaveTypeLabel(item.type)}</span>
                            <span className="leave-request-role">{[member?.roleTitle, member?.venue].filter(Boolean).join(' · ') || 'No venue'}</span>
                          </div>
                          <div className="leave-request-range">{formatRange(new Date(item.startDate), new Date(item.endDate))}</div>
                          <div className="leave-request-meta">{leaveRequestMeta(item)}</div>
                          {item.notes ? <p className="leave-request-note">“{item.notes}”</p> : null}
                          {item.managerNote ? <p className="leave-request-manager-note">Manager note: {item.managerNote}</p> : null}
                        </div>
                        <div className="leave-request-actions">
                          {item.status === 'PENDING' ? (
                            <>
                              <Input
                                label=""
                                placeholder="Note (optional)"
                                value={leaveNotes[item.id] ?? ''}
                                onChange={(event) =>
                                  setLeaveNotes((prev) => ({ ...prev, [item.id]: event.currentTarget.value }))
                                }
                              />
                              <div className="leave-request-buttons">
                                <button
                                  type="button"
                                  className="leave-action-btn is-decline"
                                  disabled={saving}
                                  onClick={() => void changeStatus(item, 'DECLINED')}
                                >
                                  Decline
                                </button>
                                <button
                                  type="button"
                                  className="leave-action-btn is-approve"
                                  disabled={saving}
                                  onClick={() => void changeStatus(item, 'APPROVED')}
                                >
                                  Approve
                                </button>
                              </div>
                            </>
                          ) : (
                            <span className={`leave-resolved-pill is-${item.status.toLowerCase()}`}>{leaveStatusLabel(item.status)}</span>
                          )}
                          {item.status !== 'CANCELLED' ? (
                            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void changeStatus(item, 'CANCELLED')}>
                              Cancel
                            </Button>
                          ) : null}
                          <ActionFeedback
                            message={messageTarget?.startsWith(`leave:${item.id}:`) ? message : null}
                            tone={message?.includes('Could') ? 'error' : 'success'}
                          />
                        </div>
                      </article>
                    );
                  })}
                </section>
              )
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
