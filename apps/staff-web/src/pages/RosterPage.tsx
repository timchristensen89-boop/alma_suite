// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import type { RosterShift, StaffProfile, StaffLeaveRequest, FatigueWarning, StaffShiftClaim } from '@alma/shared';
import { checkAvailability, type AvailabilityRule } from '@alma/shared';
import { ActionFeedback, Badge, Button, Card, EmptyState, Input, Select, StatCard, Textarea } from '@alma/ui';
import { api } from '../lib/api';
import {
  startOfWeek,
  addDays,
  shiftTimeRange,
  moveDateKeepingTime,
  sameDay,
  isDateInRange,
  rangesOverlap,
  timeOf,
  toDateInput,
  toTimeInput,
  formatRange,
  shiftHours,
  roundHours,
  uniqueValues,
  initials,
  formatCents
} from '../lib/datetime';
import { historicalSalesForDate, normaliseHistoricalVenue } from '../data/historicalSales';
import type { ForecastOutlookPayload } from '@alma/shared';
import {
  staffInitials,
  sortStaffForSelect,
  leaveTypeLabel,
  leaveOverlapsDay,
  weekDays,
  rosterClosedDaysScopeKey,
  loadRosterClosedDays,
  normaliseRosterAreaName,
  normaliseRosterAreaKey,
  loadRosterAreaSettings,
  mergeRosterAreas,
  areaStyle,
  isUnallocatedProfile,
  parseMoneyCents
} from './shared';

const ROSTER_FORECAST_STORAGE_KEY = 'alma.staff.roster.forecast.v1';

type RosterShiftContextMenu = {
  shift: RosterShift;
  x: number;
  y: number;
};

type RosterForecastDraft = {
  forecastSales: string;
  targetWagePercent: string;
  dailyForecastSales: Record<string, string>;
};

type RosterSidePanelMode = 'staff' | 'history' | 'shift';

type MobileRosterGroupKey = 'late' | 'onShift' | 'scheduled' | 'unassigned' | 'completed';

const MOBILE_ROSTER_MEDIA_QUERY = '(max-width: 900px)';

type RosterScheduleRow = {
  id: string;
  label: string;
  sublabel: string;
  initials: string;
  shifts: RosterShift[];
  member: StaffProfile | null;
  venue: string;
  area: string;
  isVenueHeader?: boolean;
};

type MobileRosterVenueGroup = {
  venue: string;
  initials: string;
  shifts: RosterShift[];
  areas: Array<{
    area: string;
    shifts: RosterShift[];
  }>;
};

function useRosterMobileMode() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia(MOBILE_ROSTER_MEDIA_QUERY).matches || new URLSearchParams(window.location.search).get('force-mobile-runtime') === '1'
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const query = window.matchMedia(MOBILE_ROSTER_MEDIA_QUERY);
    const update = () => {
      const forced = new URLSearchParams(window.location.search).get('force-mobile-runtime') === '1';
      setIsMobile(query.matches || forced);
    };
    update();

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }

    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return isMobile;
}

// Manager side of open shifts: who has put their hand up, and the decision.
// Approving assigns the shift and closes every other request on it in one
// transaction, so two people can never both be told yes.
function ShiftClaimsPanel({ onDecided }: { onDecided: () => Promise<void> }) {
  const [claims, setClaims] = useState<StaffShiftClaim[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setClaims(await api<StaffShiftClaim[]>('/api/staff/roster/claims'));
    } catch {
      // A manager who cannot see claims (or an older API) should not break the
      // roster board — the panel simply stays hidden.
      setClaims([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(claim: StaffShiftClaim, approve: boolean) {
    setBusyId(claim.id);
    setMessage(null);
    setMessageTarget(claim.id);
    try {
      await api(`/api/staff/roster/claims/${claim.id}/decide`, { method: 'POST', body: JSON.stringify({ approve }) });
      await Promise.all([load(), onDecided()]);
      setMessage(approve ? 'Shift assigned.' : 'Request declined.');
      setMessageTarget(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save that decision.');
    } finally {
      setBusyId(null);
    }
  }

  if (claims.length === 0) return null;

  // Several people can ask for the same shift, so group by shift: the decision
  // is really "who gets this one", not a queue of unrelated approvals.
  const byShift = new Map<string, StaffShiftClaim[]>();
  for (const claim of claims) {
    if (!claim.shift) continue;
    const list = byShift.get(claim.shift.id) ?? [];
    list.push(claim);
    byShift.set(claim.shift.id, list);
  }

  return (
    <Card
      title="Shift requests"
      subtitle="Staff asking to work an open shift, or to take a shift a teammate has offered to swap. Approving assigns it and declines the rest."
      padding="none"
      action={<Badge tone="warning">{claims.length} waiting</Badge>}
    >
      {message && !messageTarget ? <p className="subtle" style={{ padding: '0 1rem' }}>{message}</p> : null}
      <div className="staff-mobile-shift-list">
        {[...byShift.values()].map((group) => {
          const shift = group[0]!.shift!;
          return (
            <div key={shift.id} className="staff-mobile-shift-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
              <span>
                <strong>
                  {new Date(shift.startsAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })} · {timeOf(shift.startsAt)}-{timeOf(shift.endsAt)}
                  {shift.isSwap ? <Badge tone="info">Swap</Badge> : null}
                </strong>
                <span className="subtle">
                  {shift.area || shift.roleTitle || 'Shift'} · {shift.venue || 'No venue'}
                  {group.length > 1 ? ` · ${group.length} people want it` : ''}
                </span>
                <span className="subtle">
                  {shift.isSwap && shift.offeredBy
                    ? `Currently ${shift.offeredBy.firstName} ${shift.offeredBy.lastName}’s shift — approving moves it off them`
                    : 'Nobody rostered on'}
                  {shift.offerNote ? ` — “${shift.offerNote}”` : ''}
                </span>
              </span>
              {group.map((claim) => (
                <span key={claim.id} className="staff-row-actions" style={{ justifyContent: 'space-between' }}>
                  <span>
                    <strong>{claim.staffProfile?.firstName} {claim.staffProfile?.lastName}</strong>
                    <span className="subtle">
                      {claim.staffProfile?.roleTitle || 'No role'}
                      {claim.note ? ` · “${claim.note}”` : ''}
                    </span>
                  </span>
                  <span className="staff-row-actions">
                    <Button type="button" size="sm" disabled={busyId === claim.id} onClick={() => void decide(claim, true)}>
                      {busyId === claim.id ? 'Saving…' : shift.isSwap ? 'Approve swap' : 'Give them the shift'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={busyId === claim.id} onClick={() => void decide(claim, false)}>
                      Decline
                    </Button>
                    <ActionFeedback message={messageTarget === claim.id ? message : null} tone="error" />
                  </span>
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function RosterPage({
  staff,
  roster,
  reload
}: {
  staff: StaffProfile[];
  roster: RosterShift[];
  reload: (rosterStart?: Date, rosterEnd?: Date) => Promise<void>;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [boardDays, setBoardDays] = useState<7 | 14>(7);
  const [viewMode, setViewMode] = useState<'team' | 'area'>('area');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RosterShift['status']>('all');
  const [staffProfileId, setStaffProfileId] = useState(staff[0]?.id ?? '');
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('16:00');
  const [area, setArea] = useState('Floor');
  const [shiftVenue, setShiftVenue] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [venueFilter, setVenueFilter] = useState('all');
  const [breakMinutes, setBreakMinutes] = useState('30');
  const [shiftStatus, setShiftStatus] = useState<RosterShift['status']>('DRAFT');
  const [shiftNotes, setShiftNotes] = useState('');
  const [editingShift, setEditingShift] = useState<RosterShift | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // Leave requests overlapping the displayed week — drives the on-leave
  // overlay on roster cells so managers don't have to cross-check leave
  // before scheduling a shift.
  const [leaveOverlays, setLeaveOverlays] = useState<StaffLeaveRequest[]>([]);
  // Deputy stop-gap import modal — open via the editorial header button.
  const [deputyImportOpen, setDeputyImportOpen] = useState(false);
  const [draggingShiftId, setDraggingShiftId] = useState<string | null>(null);
  const [staffDropTargetShiftId, setStaffDropTargetShiftId] = useState<string | null>(null);
  const [shiftContextMenu, setShiftContextMenu] = useState<RosterShiftContextMenu | null>(null);
  const [publishPreviewOpen, setPublishPreviewOpen] = useState(false);
  // Roster delete controls: one "Delete" dropdown + a section/area picker.
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  // Phones fold the roster tools behind one "Tools" button (see the
  // .alma-roster-tools rules) — desktop renders the same children inline.
  const [rosterToolsOpen, setRosterToolsOpen] = useState(false);
  const [sidePanelMode, setSidePanelMode] = useState<RosterSidePanelMode>('staff');
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false);
  const [collapsedRowIds, setCollapsedRowIds] = useState<Set<string>>(new Set());
  const [collapsedVenues, setCollapsedVenues] = useState<Set<string>>(new Set());
  const [forecastDraft] = useState(loadRosterForecastDraft);
  const [forecastSales, setForecastSales] = useState(forecastDraft.forecastSales);
  const [dailyForecastSales, setDailyForecastSales] = useState<Record<string, string>>(forecastDraft.dailyForecastSales);
  const [targetWagePercent, setTargetWagePercent] = useState(forecastDraft.targetWagePercent);
  const [closedDaysByScope] = useState(loadRosterClosedDays);
  const [rosterAreaSettings] = useState(loadRosterAreaSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [historicalOpen, setHistoricalOpen] = useState(false);
  const [staffCardHover, setStaffCardHover] = useState<{
    member: StaffProfile;
    memberShifts: RosterShift[];
    memberHours: number;
    rateLabel: string;
    costLabel: string;
    x: number;
    y: number;
  } | null>(null);
  const [mobileSelectedDay, setMobileSelectedDay] = useState(() => toDateInput(new Date()));
  const isMobileRoster = useRosterMobileMode();

  // ── Optimistic board state ────────────────────────────────────────────────
  //
  // The board owns its shifts. Every edit used to POST and then refetch the
  // whole staff list AND the whole roster (~335 KB here, far more on a full
  // team), with a global loading flag that blanked the board mid-edit. Placing
  // a shift now paints immediately and reconciles with the server's row when
  // it lands; if the request fails the board snaps back and says why.
  const [shifts, setShifts] = useState<RosterShift[]>(roster);
  // Times for click-to-add. They follow the last shift placed or edited, so
  // rostering a row of identical shifts is a row of single clicks.
  const [quickTimes, setQuickTimes] = useState({ start: '10:00', end: '16:00', breakMinutes: '30' });
  // Stated availability, loaded with the board so it is visible while placing
  // shifts rather than discovered after publishing.
  const [availabilityRules, setAvailabilityRules] = useState<Array<AvailabilityRule & { staffProfileId: string }>>([]);
  const [unavailability, setUnavailability] = useState<Array<{ staffProfileId: string; startsAt: string; endsAt: string; reason: string | null }>>([]);
  // Fatigue is computed by the API, which can see the shifts either side of the
  // displayed week. A run of days or a short rest gap straddles the boundary,
  // so the board cannot work it out from what it holds.
  const [fatigue, setFatigue] = useState<Array<{ shiftId: string; staffProfileId: string; warnings: FatigueWarning[] }>>([]);
  // One level of undo for the last board action. Quick-add makes a stray click
  // cheap to make, so it has to be cheap to take back.
  const [lastUndo, setLastUndo] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const [boardBusy, setBoardBusy] = useState(false);

  /** Refresh just the board, without the global loading flash. */
  const refreshBoard = useCallback(async (start: Date, end: Date) => {
    const query = `?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;
    const board = await api<{
      shifts: RosterShift[];
      availability?: Array<AvailabilityRule & { staffProfileId: string }>;
      unavailability?: Array<{ staffProfileId: string; startsAt: string; endsAt: string; reason: string | null }>;
      fatigue?: Array<{ shiftId: string; staffProfileId: string; warnings: FatigueWarning[] }>;
    }>(`/api/staff/roster-board${query}`);
    setShifts(board.shifts);
    setAvailabilityRules(board.availability ?? []);
    setUnavailability(board.unavailability ?? []);
    setFatigue(board.fatigue ?? []);
  }, []);

  /**
   * Apply a change immediately, then run the server call.
   *
   * On failure the previous shifts are restored, so a rejected save can never
   * leave the board showing a shift that does not exist. `settle` folds the
   * server's authoritative row back in — ids, computed fields and all.
   */
  const optimistic = useCallback(
    async <T,>(
      apply: (current: RosterShift[]) => RosterShift[],
      request: () => Promise<T>,
      settle?: (result: T, current: RosterShift[]) => RosterShift[],
    ): Promise<T | null> => {
      let snapshot: RosterShift[] = [];
      setShifts((current) => { snapshot = current; return apply(current); });
      setBoardBusy(true);
      try {
        const result = await request();
        if (settle) setShifts((current) => settle(result, current));
        return result;
      } catch (error) {
        setShifts(snapshot);
        // Clear the target so the failure lands in the board's own message
        // area. Targeted messages only render beside the control that set
        // them, and a rolled-back edit must never revert silently — the shift
        // disappearing and reappearing with no explanation is worse than the
        // slow version it replaced.
        setMessageTarget(null);
        const reason = error instanceof Error ? error.message.replace(/\.\s*$/, '') : '';
        setMessage(
          reason
            ? `Could not save that change — ${reason}. The board has been put back as it was.`
            : 'Could not save that change. The board has been put back as it was.'
        );
        return null;
      } finally {
        setBoardBusy(false);
      }
    },
    [],
  );
  const days = useMemo(() => weekDays(weekStart, boardDays), [boardDays, weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, boardDays), [boardDays, weekStart]);
  const venues = useMemo(() => uniqueValues(staff.map((member) => member.venue).filter(Boolean) as string[]), [staff]);
  // Roster only shows staff who can actually work a shift. Exclude both
  // ARCHIVED and TERMINATED; keep PENDING (new hires about to start are
  // commonly rostered ahead of their first shift).
  const activeStaff = useMemo(
    () =>
      staff.filter(
        (member) => member.employmentStatus !== 'ARCHIVED' && member.employmentStatus !== 'TERMINATED'
      ),
    [staff]
  );
  // O(1) pay-rate lookups — avoids O(N) staff.find() inside every reduce/map
  const staffById = useMemo(() => new Map(staff.map((m) => [m.id, m])), [staff]);

  /**
   * Availability verdict for a proposed shift.
   *
   * Deliberately advisory: a manager who has spoken to someone must still be
   * able to place the shift. Leave clashes and double-bookings stay hard
   * blocks; stated availability is a warning, because it goes stale and the
   * manager is the one holding the conversation.
   */
  const availabilityFor = useCallback(
    (memberId: string, startsAt: Date, endsAt: Date) => checkAvailability(
      startsAt,
      endsAt,
      availabilityRules.filter((rule) => rule.staffProfileId === memberId),
      unavailability
        .filter((block) => block.staffProfileId === memberId)
        .map((block) => ({ startsAt: new Date(block.startsAt), endsAt: new Date(block.endsAt), reason: block.reason }))
    ),
    [availabilityRules, unavailability]
  );
  const fatigueByShift = useMemo(
    () => new Map(fatigue.map((entry) => [entry.shiftId, entry.warnings])),
    [fatigue]
  );
  const venueRoster = useMemo(() => shifts
    .filter((shift) => venueFilter === 'all' || shift.venue === venueFilter || shift.staffProfile?.venue === venueFilter)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [shifts, venueFilter]
  );
  const visibleRoster = useMemo(() => venueRoster
    .filter((shift) => statusFilter === 'all' || shift.status === statusFilter),
    [venueRoster, statusFilter]
  );
  const publishableDrafts = useMemo(() => venueRoster.filter((shift) => shift.status === 'DRAFT'), [venueRoster]);
  const draftCount = publishableDrafts.length;
  const rosteredStaffIds = useMemo(() => new Set(visibleRoster.map((shift) => shift.staffProfileId)), [visibleRoster]);
  const totalHours = useMemo(() => visibleRoster.reduce((sum, shift) => sum + shiftHours(shift), 0), [visibleRoster]);
  const averageRateCents = useMemo(() => {
    const rates = activeStaff
      .map((member) => rosterHourlyRateCents(member) ?? 0)
      .filter((rate) => rate > 0);
    return rates.length ? Math.round(rates.reduce((sum, rate) => sum + rate, 0) / rates.length) : 3200;
  }, [activeStaff]);
  const rosterCostCents = useMemo(() => visibleRoster.reduce((sum, shift) => {
    const member = shift.staffProfileId ? staffById.get(shift.staffProfileId) : undefined;
    // Use the staffer's effective hourly cost; fall back to the roster average
    // when they have no usable rate (or it was clamped away as bad data).
    const rateCents = (member ? rosterHourlyRateCents(member) : null) ?? averageRateCents;
    return sum + Math.round(shiftHours(shift) * rateCents);
  }, 0), [averageRateCents, staffById, visibleRoster]);
  const operationalVenues = useMemo(() => venues.some((venue) => venue === 'Alma Avalon' || venue === 'St Alma')
    ? venues.filter((venue) => venue === 'Alma Avalon' || venue === 'St Alma')
    : venues, [venues]);
  const forecastVenues = useMemo(() => venueFilter === 'all' ? operationalVenues : [venueFilter].filter((venue) => venue && venue !== 'all' && venue !== 'Both'), [operationalVenues, venueFilter]);
  const rosterClosedVenueScope = useMemo(() => venueFilter === 'all' ? operationalVenues : [venueFilter].filter((venue) => venue && venue !== 'all' && venue !== 'Both'), [operationalVenues, venueFilter]);
  const isVenueClosedOnDate = useCallback((venue: string | null | undefined, day: Date) => {
    const selectedVenue = normaliseRosterAreaName(venue ?? '');
    const scopedVenue =
      selectedVenue && selectedVenue !== 'all' && selectedVenue !== 'Both'
        ? selectedVenue
        : venueFilter !== 'all' && venueFilter !== 'Both'
          ? venueFilter
          : '';
    if (!scopedVenue) return false;
    const scopeKey = rosterClosedDaysScopeKey(weekStart, boardDays, scopedVenue);
    return (closedDaysByScope[scopeKey] ?? []).includes(toDateInput(day));
  }, [boardDays, closedDaysByScope, venueFilter, weekStart]);
  const closedVenuesForDay = useCallback(
    (day: Date) => rosterClosedVenueScope.filter((venue) => isVenueClosedOnDate(venue, day)),
    [isVenueClosedOnDate, rosterClosedVenueScope]
  );
  // Live forecast engine outlook (13 weeks from the current Monday). When a
  // viewed day is inside the horizon, the engine's prediction replaces the
  // legacy hardcoded historical table as the baseline; the static table stays
  // as the fallback for past weeks and for when the fetch fails.
  const [engineOutlook, setEngineOutlook] = useState<ForecastOutlookPayload | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api<ForecastOutlookPayload>('/api/forecast/outlook?weeks=13')
      .then((next) => {
        if (!cancelled) setEngineOutlook(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const engineSalesByVenueDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const venueOutlook of engineOutlook?.venues ?? []) {
      for (const day of venueOutlook.days) {
        map.set(`${venueOutlook.venue}|${day.date}`, day.salesForecastCents);
      }
    }
    return map;
  }, [engineOutlook]);
  const engineSalesCentsForDate = useCallback(
    (venue: string, day: Date): number | null => {
      const key = `${venue}|${toDateInput(day)}`;
      return engineSalesByVenueDay.has(key) ? engineSalesByVenueDay.get(key)! : null;
    },
    [engineSalesByVenueDay]
  );
  // Engine first, hardcoded table as fallback — one place, used everywhere a
  // baseline is read so the numbers can never disagree within the page.
  const baselineSalesCentsForDate = useCallback(
    (venue: string, day: Date): number => {
      const engine = engineSalesCentsForDate(venue, day);
      if (engine != null) return engine;
      return Math.round(historicalSalesForDate(venue, day) * 100);
    },
    [engineSalesCentsForDate]
  );

  const isDayClosedForCurrentView = useCallback(
    (day: Date) => rosterClosedVenueScope.length > 0 && rosterClosedVenueScope.every((venue) => isVenueClosedOnDate(venue, day)),
    [isVenueClosedOnDate, rosterClosedVenueScope]
  );
  const closedDayCount = useMemo(() => days.reduce((sum, day) => sum + closedVenuesForDay(day).length, 0), [closedVenuesForDay, days]);
  const historicalDailyForecast = useMemo(() => days.reduce((map, day) => {
    const cents = forecastVenues.reduce((sum, venue) => sum + baselineSalesCentsForDate(venue, day), 0);
    map[toDateInput(day)] = cents;
    return map;
  }, {} as Record<string, number>), [baselineSalesCentsForDate, days, forecastVenues]);
  const historicalForecastSalesCents = useMemo(() => Object.values(historicalDailyForecast).reduce((sum, cents) => sum + cents, 0), [historicalDailyForecast]);
  const forecastHasManualDailyInputs = useMemo(() => days.some((day) => parseMoneyCents(dailyForecastSales[toDateInput(day)] ?? '') > 0), [dailyForecastSales, days]);
  // Sum of MANUAL per-day forecast inputs only. Previously this fell
  // through to the historical daily forecast when no per-day inputs
  // were set — but that meant typing $50,000 into the weekly forecast
  // field was silently overridden by ~$57,992 of historical sales,
  // and labour-% maths used the historical number instead of the user
  // input. Now the historical fallback only kicks in at the top level
  // (when both daily and weekly are empty).
  const dailyForecastTotalCents = useMemo(() => days.reduce((sum, day) => {
    const key = toDateInput(day);
    return sum + parseMoneyCents(dailyForecastSales[key] ?? '');
  }, 0), [dailyForecastSales, days]);
  // Priority for the weekly aggregate: per-day manual sum → weekly
  // manual input → historical reference. Whichever the user actually
  // touched most recently wins.
  const forecastSalesCents = useMemo(() => {
    if (dailyForecastTotalCents > 0) return dailyForecastTotalCents;
    const weekly = parseMoneyCents(forecastSales);
    if (weekly > 0) return weekly;
    return historicalForecastSalesCents;
  }, [dailyForecastTotalCents, forecastSales, historicalForecastSalesCents]);
  const wageBudgetCents = useMemo(() => Math.round(forecastSalesCents * (parsePercent(targetWagePercent) / 100)), [forecastSalesCents, targetWagePercent]);
  const recommendedHours = averageRateCents > 0 ? wageBudgetCents / averageRateCents : 0;
  const forecastCostGapCents = wageBudgetCents - rosterCostCents;
  const forecastHoursGap = recommendedHours - totalHours;
  const missingRateStaff = useMemo(() => activeStaff.filter((member) =>
    rosteredStaffIds.has(member.id) &&
    !member.payRateCents &&
    !member.trainingPayRateCents
  ), [activeStaff, rosteredStaffIds]);
  const publishedCount = useMemo(() => visibleRoster.filter((shift) => shift.status === 'PUBLISHED').length, [visibleRoster]);
  const targetWagePercentParsed = useMemo(() => parsePercent(targetWagePercent) / 100, [targetWagePercent]);
  const dailySummaries = useMemo(() => days.map((day) => {
    const shifts = visibleRoster.filter((shift) => sameDay(new Date(shift.startsAt), day));
    const plannedCostCents = shifts.reduce((sum, shift) => {
      const member = shift.staffProfileId ? staffById.get(shift.staffProfileId) : undefined;
      const rateCents = (member ? rosterHourlyRateCents(member) : null) ?? averageRateCents;
      return sum + Math.round(shiftHours(shift) * rateCents);
    }, 0);
    const dayKey = toDateInput(day);
    const manualCents = parseMoneyCents(dailyForecastSales[dayKey] ?? '');
    const forecastCents = manualCents || (!forecastHasManualDailyInputs ? historicalDailyForecast[dayKey] ?? 0 : 0);
    const budgetCents = Math.round(forecastCents * targetWagePercentParsed);
    return {
      day,
      shifts: shifts.length,
      hours: shifts.reduce((sum, shift) => sum + shiftHours(shift), 0),
      people: new Set(shifts.map((shift) => shift.staffProfileId)).size,
      forecastCents,
      plannedCostCents,
      budgetCents,
      wagePercent: forecastCents > 0 ? (plannedCostCents / forecastCents) * 100 : 0
    };
  }), [averageRateCents, dailyForecastSales, days, forecastHasManualDailyInputs, historicalDailyForecast, staffById, targetWagePercentParsed, visibleRoster]);
  const mobileSelectedDate = useMemo(() => new Date(`${mobileSelectedDay}T00:00:00`), [mobileSelectedDay]);
  const mobileSelectedSummary = useMemo(() => dailySummaries.find((summary) => sameDay(summary.day, mobileSelectedDate)), [dailySummaries, mobileSelectedDate]);
  const mobileDayShifts = useMemo(() => visibleRoster.filter((shift) => sameDay(new Date(shift.startsAt), mobileSelectedDate)), [mobileSelectedDate, visibleRoster]);
  // The input stays on `search` so typing is never laggy; the row rebuild —
  // which filters and regroups every shift on the board — runs off the
  // deferred copy and is allowed to fall a frame behind. Without this every
  // keystroke recomputed the whole board synchronously before the character
  // appeared.
  const deferredSearch = useDeferredValue(search);
  const rowSearch = useMemo(() => deferredSearch.trim().toLowerCase(), [deferredSearch]);
  const allRosterAreas = useMemo(
    () => mergeRosterAreas(rosterAreaSettings, visibleRoster.map((shift) => shift.area || 'Shift')),
    [rosterAreaSettings, visibleRoster]
  );
  // Distinct area values present in the currently-visible roster — drives
  // the "Delete by location/area" bulk-delete control.
  const bulkDeleteAreas = useMemo(
    () => uniqueValues(visibleRoster.map((shift) => shift.area || 'Shift')),
    [visibleRoster]
  );
  const unallocatedShiftCount = useMemo(
    () => visibleRoster.filter(isOpenShift).length,
    [visibleRoster]
  );
  const hiddenAreaNames = useMemo(() => new Set(rosterAreaSettings.hidden.map(normaliseRosterAreaKey)), [rosterAreaSettings.hidden]);
  const activeAreas = useMemo(
    () => allRosterAreas.filter((areaName) => !hiddenAreaNames.has(normaliseRosterAreaKey(areaName))),
    [allRosterAreas, hiddenAreaNames]
  );
  const areaSelectOptions = useMemo(
    () => uniqueValues([...allRosterAreas, area || 'Floor']).map((item) => ({ label: item, value: item })),
    [allRosterAreas, area]
  );
  const areaVenues = useMemo(
    () => uniqueValues([
      ...(venueFilter === 'all' ? operationalVenues : [venueFilter]),
      ...visibleRoster.map((shift) => shift.venue || shift.staffProfile?.venue || '').filter(Boolean)
    ]).filter((venue) => venue && venue !== 'all' && venue !== 'Both'),
    [operationalVenues, venueFilter, visibleRoster]
  );
  const splitAreaRows = useMemo(() => areaVenues.flatMap((venue) =>
    activeAreas.map((areaName) => {
      const shifts = visibleRoster.filter((shift) =>
        (shift.area || 'Shift') === areaName &&
        (shift.venue === venue || shift.staffProfile?.venue === venue)
      );
      return {
        id: `${venue}:${areaName}`,
        label: areaName,
        sublabel: `${venue} · ${shifts.length} shifts`,
        initials: areaName.slice(0, 2).toUpperCase(),
        shifts,
        member: null,
        venue,
        area: areaName
      };
    })
  ), [activeAreas, areaVenues, visibleRoster]);
  const mobileVenueGroups: MobileRosterVenueGroup[] = useMemo(() => areaVenues
    .map((venue) => {
      const areaRows = splitAreaRows
        .filter((row) => row.venue === venue)
        .filter((row) => `${row.venue} ${row.label} ${row.sublabel}`.toLowerCase().includes(rowSearch))
        .map((row) => ({
          area: row.area || row.label,
          shifts: row.shifts.filter((shift) => sameDay(new Date(shift.startsAt), mobileSelectedDate))
        }))
        .filter((row) => row.shifts.length > 0);
      const shifts = areaRows.flatMap((row) => row.shifts);
      return {
        venue,
        initials: venue.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
        shifts,
        areas: areaRows
      };
    })
    .filter((group) => group.shifts.length > 0), [areaVenues, mobileSelectedDate, rowSearch, splitAreaRows]);
  const venueForecastRows = useMemo(() => forecastVenues.map((venue) => {
    const shifts = visibleRoster.filter((shift) => shift.venue === venue || shift.staffProfile?.venue === venue);
    const plannedHours = shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
    const plannedCostCents = shifts.reduce((sum, shift) => {
      const member = shift.staffProfileId ? staffById.get(shift.staffProfileId) : undefined;
      const rateCents = (member ? rosterHourlyRateCents(member) : null) ?? averageRateCents;
      return sum + Math.round(shiftHours(shift) * rateCents);
    }, 0);
    const historicalSalesCents = days.reduce((sum, day) => sum + baselineSalesCentsForDate(venue, day), 0);
    const dayKeys = days.map((day) => toDateInput(day));
    const manualDailyCents = dayKeys.reduce((sum, key) => sum + parseMoneyCents(dailyForecastSales[key] ?? ''), 0);
    const selectedSalesCents =
      venueFilter === 'all'
        ? historicalSalesCents
        : manualDailyCents || parseMoneyCents(forecastSales) || historicalSalesCents;
    const budgetCents = Math.round(selectedSalesCents * (parsePercent(targetWagePercent) / 100));
    const recommended = averageRateCents > 0 ? budgetCents / averageRateCents : 0;
    return {
      venue,
      source: normaliseHistoricalVenue(venue),
      salesCents: selectedSalesCents,
      historicalSalesCents,
      budgetCents,
      plannedCostCents,
      plannedHours,
      recommendedHours: recommended,
      costGapCents: budgetCents - plannedCostCents,
      hoursGap: recommended - plannedHours
    };
  }), [averageRateCents, dailyForecastSales, days, forecastSales, forecastVenues, staffById, targetWagePercent, venueFilter, visibleRoster]);
  const publishWarnings = useMemo(() => {
    const unallocatedCount = visibleRoster.filter(isOpenShift).length;
    const noVenueCount = visibleRoster.filter((shift) => !shift.venue && !shift.staffProfile?.venue).length;
    const overlapCount = countRosterOverlaps(visibleRoster);
    return [
      ...(forecastSalesCents > 0 && forecastCostGapCents < 0
        ? [`Roster is ${formatCents(Math.abs(forecastCostGapCents))} over the forecast wage budget.`]
        : []),
      ...(missingRateStaff.length
        ? [`${missingRateStaff.length} rostered staff member${missingRateStaff.length === 1 ? '' : 's'} missing pay rates.`]
        : []),
      ...(unallocatedCount > 0
        ? [`${unallocatedCount} unallocated shift${unallocatedCount === 1 ? '' : 's'} still need a real staff member.`]
        : []),
      ...(noVenueCount > 0
        ? [`${noVenueCount} shift${noVenueCount === 1 ? '' : 's'} missing a venue.`]
        : []),
      ...(overlapCount > 0
        ? [`${overlapCount} overlapping shift conflict${overlapCount === 1 ? '' : 's'} found.`]
        : [])
    ];
  }, [forecastCostGapCents, forecastSalesCents, missingRateStaff, visibleRoster]);
  const areaGuidanceRows = useMemo(() => areaVenues.flatMap((venue) => activeAreas.map((areaName) => {
    const shifts = visibleRoster.filter((shift) =>
      (shift.area || 'Shift') === areaName &&
      (shift.venue === venue || shift.staffProfile?.venue === venue)
    );
    const hours = shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
    const venueForecast = venueForecastRows.find((row) => row.venue === venue);
    const venueHours = visibleRoster
      .filter((shift) => shift.venue === venue || shift.staffProfile?.venue === venue)
      .reduce((sum, shift) => sum + shiftHours(shift), 0);
    const recommended = venueForecast && venueHours > 0 ? venueForecast.recommendedHours * (hours / venueHours) : 0;
    const bestDay = dailySummaries
      .map((summary) => {
        const areaHours = visibleRoster
          .filter((shift) =>
            (shift.area || 'Shift') === areaName &&
            (shift.venue === venue || shift.staffProfile?.venue === venue) &&
            sameDay(new Date(shift.startsAt), summary.day)
          )
          .reduce((sum, shift) => sum + shiftHours(shift), 0);
        const dayRecommended =
          summary.forecastCents > 0 && averageRateCents > 0
            ? summary.budgetCents / averageRateCents
            : summary.hours;
        const dayAreaRecommended = summary.hours > 0 ? dayRecommended * (areaHours / summary.hours) : 0;
        return {
          day: summary.day,
          gap: dayAreaRecommended - areaHours
        };
      })
      .sort((a, b) => b.gap - a.gap)[0];
    return {
      area: areaName,
      venue,
      plannedHours: hours,
      recommendedHours: recommended,
      gap: recommended - hours,
      day: bestDay?.day ?? days[0] ?? weekStart,
      dayGap: bestDay?.gap ?? 0
    };
  })).filter((row) => row.plannedHours > 0 || row.recommendedHours > 0),
  [activeAreas, areaVenues, averageRateCents, dailySummaries, days, venueForecastRows, visibleRoster, weekStart]);
  const selectedMember = useMemo(() => staffById.get(staffProfileId ?? ''), [staffById, staffProfileId]);
  const selectedShiftHours = shiftTimeRange(date, startTime, endTime);
  const shiftConflicts = useMemo(() => {
    if (!selectedShiftHours || !staffProfileId) return [];
    return shifts.filter((shift) => {
      if (shift.id === editingShift?.id) return false;
      if (shift.staffProfileId !== staffProfileId) return false;
      if (shift.status === 'CANCELLED') return false;
      return rangesOverlap(
        selectedShiftHours.startsAt,
        selectedShiftHours.endsAt,
        new Date(shift.startsAt),
        new Date(shift.endsAt)
      );
    });
  }, [editingShift?.id, shifts, selectedShiftHours, staffProfileId]);
  // Leave clashes — if the staff is on approved/pending leave during the
  // shift window, surface it so we can hard-block the save.
  const shiftLeaveClashes = useMemo(() => {
    if (!selectedShiftHours || !staffProfileId) return [];
    const start = selectedShiftHours.startsAt;
    return leaveOverlays.filter((leave) => {
      if (leave.staffProfileId !== staffProfileId) return false;
      if (leave.status === 'CANCELLED' || leave.status === 'DECLINED') return false;
      return leaveOverlapsDay(leave, start);
    });
  }, [leaveOverlays, selectedShiftHours, staffProfileId]);
  const hasHardClash = shiftConflicts.length > 0 || shiftLeaveClashes.length > 0;
  const canSaveShift = Boolean(staffProfileId && date && startTime && endTime && selectedShiftHours) && !hasHardClash;
  const scheduleRows: RosterScheduleRow[] = useMemo(() =>
    viewMode === 'team'
      ? activeStaff
          .filter((member) =>
            `${member.firstName} ${member.lastName} ${member.roleTitle} ${member.venue ?? ''}`
              .toLowerCase()
              .includes(rowSearch)
          )
          .map((member) => ({
            id: member.id,
            label: `${member.firstName} ${member.lastName}`,
            sublabel: `${member.roleTitle || 'Team member'} · ${member.venue || 'No venue'}`,
            initials: initials(member),
            shifts: visibleRoster.filter((shift) => shift.staffProfileId === member.id),
            member,
            venue: member.venue ?? '',
            area: ''
          }))
      : splitAreaRows.filter((row) =>
          `${row.venue} ${row.label} ${row.sublabel}`.toLowerCase().includes(rowSearch)
        )
          .reduce<RosterScheduleRow[]>((rows, row, index, sourceRows) => {
            const previous = sourceRows[index - 1];
            if (!previous || previous.venue !== row.venue) {
              rows.push({
                id: `venue-header:${row.venue}`,
                label: row.venue,
                sublabel: 'Venue section',
                initials: row.venue.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
                shifts: visibleRoster.filter((shift) => shift.venue === row.venue || shift.staffProfile?.venue === row.venue),
                member: null,
                venue: row.venue,
                area: '',
                isVenueHeader: true
              });
            }
            rows.push(row);
            return rows;
          }, []),
  [activeStaff, rowSearch, splitAreaRows, viewMode, visibleRoster]);
  const activeSidePanelMode: RosterSidePanelMode =
    sidePanelMode === 'shift' && !editorOpen ? 'staff' : sidePanelMode;
  const sidePanelStaff = useMemo(() => activeStaff
    .filter((member) => venueFilter === 'all' || member.venue === venueFilter)
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
  [activeStaff, venueFilter]);
  const scheduleGridStyle = useMemo<CSSProperties>(() => {
    const sideRailOpen = !sidePanelCollapsed;
    const labelColumn = sideRailOpen ? 'minmax(88px, 0.46fr)' : 'minmax(96px, 0.42fr)';
    const openColumn =
      boardDays === 14
        ? sideRailOpen
          ? 'minmax(72px, 1fr)'
          : 'minmax(84px, 1fr)'
        : sideRailOpen
          ? 'minmax(98px, 1fr)'
          : 'minmax(116px, 1fr)';
    const closedColumn = boardDays === 14 ? 'minmax(34px, 0.16fr)' : 'minmax(40px, 0.2fr)';
    return {
      gridTemplateColumns: [
        labelColumn,
        ...days.map((day) => (isDayClosedForCurrentView(day) ? closedColumn : openColumn))
      ].join(' ')
    };
  }, [boardDays, days, isDayClosedForCurrentView, sidePanelCollapsed]);

  useEffect(() => {
    if (!staffProfileId && activeStaff[0]) setStaffProfileId(activeStaff[0].id);
  }, [activeStaff, staffProfileId]);

  // Seed from the parent's load, and whenever the parent genuinely refetches.
  //
  // The parent fetches the roster without a window, so its prop holds every
  // shift it knows about. Taking it wholesale made every board aggregate —
  // shift count, hours, labour cost, wage % against budget — sum months of
  // roster while the header said one week, and put shifts from other weeks in
  // the "needs filling" queue. Narrow it to the window on screen; the board
  // fetch below then replaces it with the server's authoritative rows.
  useEffect(() => {
    setShifts(roster.filter((shift) => {
      const startsAt = new Date(shift.startsAt);
      return startsAt >= weekStart && startsAt < weekEnd;
    }));
  }, [roster, weekEnd, weekStart]);

  // Changing week fetches the board for that window only. It used to refetch
  // the entire staff list as well and raise the global loading flag, so paging
  // between weeks blanked the screen for a payload the board never read.
  useEffect(() => {
    void refreshBoard(weekStart, weekEnd).catch(() => {
      setMessage('Could not load that week. Check your connection and try again.');
    });
  }, [refreshBoard, weekEnd, weekStart]);

  // Pull leave overlapping the displayed roster window — PENDING and
  // APPROVED only, so cancelled/rejected leave doesn't ghost the cells.
  useEffect(() => {
    void (async () => {
      try {
        const params = new URLSearchParams({
          start: toDateInput(weekStart),
          end: toDateInput(addDays(weekEnd, -1))
        });
        const leave = await api<StaffLeaveRequest[]>(`/api/staff/leave?${params.toString()}`);
        setLeaveOverlays(
          leave.filter((item) => item.status === 'PENDING' || item.status === 'APPROVED')
        );
      } catch {
        setLeaveOverlays([]);
      }
    })();
  }, [weekStart, weekEnd]);

  useEffect(() => {
    const selectedDate = new Date(`${mobileSelectedDay}T00:00:00`);
    if (!isDateInRange(selectedDate, weekStart, weekEnd)) {
      setMobileSelectedDay(toDateInput(weekStart));
    }
  }, [mobileSelectedDay, weekEnd, weekStart]);

  useEffect(() => {
    window.localStorage.setItem(
      ROSTER_FORECAST_STORAGE_KEY,
      JSON.stringify({ forecastSales, targetWagePercent, dailyForecastSales })
    );
  }, [dailyForecastSales, forecastSales, targetWagePercent]);

  useEffect(() => {
    if (!shiftContextMenu) return undefined;
    const close = () => setShiftContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [shiftContextMenu]);

  useEffect(() => {
    if (!publishPreviewOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPublishPreviewOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [publishPreviewOpen]);

  function setRosterWeek(nextWeekStart: Date) {
    setWeekStart(nextWeekStart);
    const selectedDate = new Date(`${date}T00:00:00`);
    if (!isDateInRange(selectedDate, nextWeekStart, addDays(nextWeekStart, boardDays))) {
      setDate(toDateInput(nextWeekStart));
    }
    const selectedMobileDate = new Date(`${mobileSelectedDay}T00:00:00`);
    if (!isDateInRange(selectedMobileDate, nextWeekStart, addDays(nextWeekStart, boardDays))) {
      setMobileSelectedDay(toDateInput(nextWeekStart));
    }
  }

  function openShiftPanel() {
    setEditorOpen(true);
  }

  function closeShiftPanel() {
    setEditingShift(null);
    setEditorOpen(false);
  }

  function newShift(preferredDate?: string) {
    setEditingShift(null);
    openShiftPanel();
    setDate((current) => {
      if (preferredDate) return preferredDate;
      const selectedDate = new Date(`${current}T00:00:00`);
      return isDateInRange(selectedDate, weekStart, weekEnd) ? current : toDateInput(weekStart);
    });
    setStaffProfileId((current) => current || activeStaff[0]?.id || '');
    setArea(area || 'Floor');
    setShiftVenue(venueFilter === 'all' ? selectedMember?.venue ?? activeStaff[0]?.venue ?? '' : venueFilter);
    setRoleTitle(selectedMember?.roleTitle ?? activeStaff[0]?.roleTitle ?? '');
    setShiftStatus('DRAFT');
    setShiftNotes('');
    setMessage(null);
  }

  function updateDailyForecast(day: Date, value: string) {
    const key = toDateInput(day);
    setDailyForecastSales((current) => ({ ...current, [key]: value }));
  }

  function applyHistoricalForecast() {
    setMessageTarget('forecast');
    const nextDailyForecast = days.reduce((draft, day) => {
      const cents = forecastVenues.reduce((sum, venue) => sum + baselineSalesCentsForDate(venue, day), 0);
      draft[toDateInput(day)] = cents > 0 ? String(Math.round(cents / 100)) : '';
      return draft;
    }, {} as Record<string, string>);
    const totalCents = Object.values(nextDailyForecast).reduce((sum, value) => sum + parseMoneyCents(value), 0);
    setDailyForecastSales(nextDailyForecast);
    setForecastSales(totalCents > 0 ? String(Math.round(totalCents / 100)) : '');
    setMessage('Historical sales forecast applied to this roster view.');
  }


  useEffect(() => {
    if (!editingShift) {
      const member = staff.find((item) => item.id === staffProfileId);
      if (member?.roleTitle && !roleTitle) setRoleTitle(member.roleTitle);
      if (member?.venue && !shiftVenue) setShiftVenue(member.venue);
    }
  }, [editingShift, roleTitle, shiftVenue, staff, staffProfileId]);

  async function saveShift() {
    setMessageTarget('shift-save');
    // Editing a shift that is deliberately open must not quietly hand it to
    // whoever happens to be first in the list. On an open shift, "nobody
    // chosen" means it stays open — the manager has to pick someone on purpose.
    const editingOpenShift = editingShift != null && editingShift.staffProfileId == null;
    const effectiveStaffProfileId = staffProfileId || (editingOpenShift ? '' : activeStaff[0]?.id || '');
    if (!effectiveStaffProfileId && !editingOpenShift) {
      setMessage('Choose a team member before adding the shift.');
      return;
    }
    const range = shiftTimeRange(date, startTime, endTime);
    if (!range) {
      setMessage('Check the shift date and times.');
      return;
    }
    // Hard block — staff on leave can't be rostered for this window.
    // No prompt-to-override, they need to clear the leave first.
    if (shiftLeaveClashes.length > 0) {
      const leave = shiftLeaveClashes[0]!;
      setMessage(
        `${selectedMember?.firstName ?? 'This team member'} is on ${leave.type.toLowerCase().replace('_', ' ')} this day. Resolve the leave request first or pick a different person.`
      );
      return;
    }
    // Hard block — staff already rostered overlapping (at this venue or
    // any other) can't be double-booked. They need to be released from
    // the existing shift first.
    if (shiftConflicts.length > 0) {
      const clash = shiftConflicts[0]!;
      const clashVenue = clash.venue || clash.staffProfile?.venue || 'another venue';
      setMessage(
        `${selectedMember?.firstName ?? 'This team member'} is already rostered ${timeOf(clash.startsAt)}–${timeOf(clash.endsAt)} at ${clashVenue}. Release that shift first or pick a different person.`
      );
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const member = staff.find((item) => item.id === effectiveStaffProfileId);
      const body = {
        // Empty means open: the API takes null and leaves the shift unfilled.
        staffProfileId: effectiveStaffProfileId || null,
        venue: shiftVenue || member?.venue || '',
        area: area || 'Floor',
        roleTitle: roleTitle || member?.roleTitle || '',
        startsAt: range.startsAt.toISOString(),
        endsAt: range.endsAt.toISOString(),
        breakMinutes: Number(breakMinutes) || 0,
        status: shiftStatus,
        notes: shiftNotes.trim()
      };
      const editingId = editingShift?.id ?? null;
      // Painted straight away under a temporary id, then swapped for the
      // server's row. The temp id is only ever local, so a failed save leaves
      // nothing behind.
      const tempId = `pending-${Date.now()}`;
      const draft: RosterShift = {
        ...(editingShift ?? {}),
        ...body,
        id: editingId ?? tempId,
        staffProfile: member
          ? { id: member.id, firstName: member.firstName, lastName: member.lastName, roleTitle: member.roleTitle, venue: member.venue, employmentStatus: member.employmentStatus }
          : editingShift?.staffProfile
      } as RosterShift;

      const saved = await optimistic(
        (current) => (editingId ? current.map((s) => (s.id === editingId ? draft : s)) : [...current, draft]),
        () => api<RosterShift>(editingId ? `/api/staff/roster/${editingId}` : '/api/staff/roster', {
          method: editingId ? 'PATCH' : 'POST',
          body: JSON.stringify(body)
        }),
        (result, current) => current.map((s) => (s.id === (editingId ?? tempId) ? { ...s, ...result } : s))
      );
      if (saved === null) return;

      setQuickTimes({ start: startTime, end: endTime, breakMinutes: String(Number(breakMinutes) || 0) });
      setMessage(editingId ? 'Shift updated.' : 'Shift added to the draft roster.');
      setEditingShift(null);
      closeShiftPanel();
      setRoleTitle('');
      setShiftNotes('');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save shift.');
    } finally {
      setSaving(false);
    }
  }

  function startEditShift(shift: RosterShift) {
    setShiftContextMenu(null);
    setEditingShift(shift);
    openShiftPanel();
    setStaffProfileId(shift.staffProfileId ?? '');
    setShiftVenue(shift.venue ?? shift.staffProfile?.venue ?? '');
    setDate(toDateInput(new Date(shift.startsAt)));
    setStartTime(toTimeInput(new Date(shift.startsAt)));
    setEndTime(toTimeInput(new Date(shift.endsAt)));
    setArea(shift.area ?? 'Floor');
    setRoleTitle(shift.roleTitle ?? shift.staffProfile?.roleTitle ?? '');
    setBreakMinutes(String(shift.breakMinutes));
    setShiftStatus(shift.status);
    setShiftNotes(shift.notes ?? '');
    setMessage(null);
    setMessageTarget(null);
  }

  async function deleteShift(shift: RosterShift) {
    setShiftContextMenu(null);
    if (!window.confirm('Delete this roster shift? This cannot be undone.')) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget('shift-delete');
    try {
      const removed = await optimistic(
        (current) => current.filter((s) => s.id !== shift.id),
        () => api(`/api/staff/roster/${shift.id}`, { method: 'DELETE' })
      );
      if (removed === null) return;
      if (editingShift?.id === shift.id) {
        closeShiftPanel();
      }
      setMessage('Shift deleted.');
      setMessageTarget(null);
      setLastUndo({
        label: 'Undo delete',
        run: async () => {
          // Recreated rather than restored: the row is gone server-side, so
          // this posts the same shift back and the board takes the new id.
          const body = {
            staffProfileId: shift.staffProfileId,
            venue: shift.venue ?? '',
            area: shift.area ?? 'Floor',
            roleTitle: shift.roleTitle ?? '',
            startsAt: shift.startsAt,
            endsAt: shift.endsAt,
            breakMinutes: shift.breakMinutes,
            status: shift.status,
            notes: shift.notes ?? ''
          };
          const tempId = `pending-${Date.now()}`;
          await optimistic(
            (current) => [...current, { ...shift, id: tempId } as RosterShift],
            () => api<RosterShift>('/api/staff/roster', { method: 'POST', body: JSON.stringify(body) }),
            (result, current) => current.map((s) => (s.id === tempId ? { ...s, ...result } : s))
          );
          setMessage('Shift restored.');
        }
      });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete shift.');
    } finally {
      setSaving(false);
    }
  }

  async function bulkDeleteRoster(
    scope: 'this-week' | 'next-week' | 'visible' | 'reset-all' | 'unallocated' | 'area',
    selectedArea?: string
  ) {
    setShiftContextMenu(null);
    setDeleteMenuOpen(false);
    setSectionMenuOpen(false);
    const venueLabel = venueFilter === 'all' ? 'all venues' : venueFilter;
    const venueParam = venueFilter === 'all' ? '' : venueFilter;
    const nextStart = addDays(weekStart, boardDays);
    const nextEnd = addDays(weekEnd, boardDays);

    // -1 scopeCount means "can't pre-count" (next week / reset-all aren't
    // loaded into the board) — skip the empty-view short-circuit for those.
    let scopeCount = 0;
    let confirmMessage = '';
    let body: Record<string, unknown>;

    if (scope === 'this-week') {
      scopeCount = visibleRoster.length;
      confirmMessage = `Delete ALL ${scopeCount} shift${scopeCount === 1 ? '' : 's'} for ${venueLabel} this week? This cannot be undone.`;
      body = { start: weekStart.toISOString(), end: weekEnd.toISOString(), venue: venueParam, filter: 'all' };
    } else if (scope === 'next-week') {
      scopeCount = -1;
      confirmMessage = `Delete every shift for ${venueLabel} NEXT week? This cannot be undone.`;
      body = { start: nextStart.toISOString(), end: nextEnd.toISOString(), venue: venueParam, filter: 'all' };
    } else if (scope === 'visible') {
      const ids = visibleRoster.map((shift) => shift.id);
      scopeCount = ids.length;
      confirmMessage = `Delete the ${scopeCount} shift${scopeCount === 1 ? '' : 's'} currently visible for ${venueLabel}? This respects your active filters and cannot be undone.`;
      body = { start: weekStart.toISOString(), end: weekEnd.toISOString(), venue: venueParam, filter: 'ids', ids };
    } else if (scope === 'reset-all') {
      scopeCount = -1;
      confirmMessage = `RESET ALL ROSTER DATA for ${venueLabel}? This permanently deletes every shift across every week. This cannot be undone.`;
      body = { start: weekStart.toISOString(), end: weekEnd.toISOString(), venue: venueParam, filter: 'reset-all' };
    } else if (scope === 'unallocated') {
      scopeCount = visibleRoster.filter(isOpenShift).length;
      confirmMessage = `Delete ${scopeCount} unallocated shift${scopeCount === 1 ? '' : 's'} for ${venueLabel} this week? This cannot be undone.`;
      body = { start: weekStart.toISOString(), end: weekEnd.toISOString(), venue: venueParam, filter: 'unallocated' };
    } else {
      if (!selectedArea) return;
      scopeCount = visibleRoster.filter((shift) => (shift.area || 'Shift') === selectedArea).length;
      confirmMessage = `Delete ${scopeCount} shift${scopeCount === 1 ? '' : 's'} in the ${selectedArea} section for ${venueLabel} this week? This cannot be undone.`;
      body = { start: weekStart.toISOString(), end: weekEnd.toISOString(), venue: venueParam, filter: 'area', area: selectedArea };
    }

    if (scopeCount === 0) {
      setMessage('No shifts to delete in this view.');
      setMessageTarget('shift-delete');
      return;
    }
    if (!window.confirm(confirmMessage)) return;
    // Reset-all is destructive enough to warrant a second confirm.
    if (scope === 'reset-all' && !window.confirm('Are you absolutely sure? This wipes the entire roster for every week.')) {
      return;
    }
    setSaving(true);
    setMessage(null);
    setMessageTarget('shift-delete');
    try {
      const { deleted } = await api<{ deleted: number }>('/api/staff/roster/bulk-delete', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      await refreshBoard(weekStart, weekEnd);
      setMessage(`Deleted ${deleted} shift${deleted === 1 ? '' : 's'}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete shifts.');
    } finally {
      setSaving(false);
    }
  }

  async function publishWeek() {
    if (
      publishWarnings.length > 0 &&
      !window.confirm(`Publish roster with these warnings?\n\n${publishWarnings.map((warning) => `- ${warning}`).join('\n')}`)
    ) {
      return;
    }
    setSaving(true);
    setMessage(null);
    setMessageTarget('publish');
    try {
      const published = await api<{
        notified?: { emailed: number; pushed?: number; skipped: Array<{ name: string; reason: string }> };
      }>('/api/staff/roster/publish', {
        method: 'POST',
        body: JSON.stringify({
          start: weekStart.toISOString(),
          end: weekEnd.toISOString(),
          venue: venueFilter === 'all' ? '' : venueFilter,
          forecast: {
            source: forecastHasManualDailyInputs || forecastSales ? 'manager_override' : 'historical_sales',
            targetWagePercent: parsePercent(targetWagePercent),
            forecastSalesCents,
            wageBudgetCents,
            rosterCostCents,
            plannedHours: totalHours,
            recommendedHours,
            dailySalesCents: days.reduce((draft, day) => {
              const key = toDateInput(day);
              draft[key] = dailySummaries.find((summary) => sameDay(summary.day, day))?.forecastCents ?? 0;
              return draft;
            }, {} as Record<string, number>),
            venueBreakdown: venueForecastRows,
            areaBreakdown: areaGuidanceRows.map((row) => ({
              venue: row.venue,
              area: row.area,
              plannedHours: row.plannedHours,
              recommendedHours: row.recommendedHours,
              gap: row.gap,
              day: row.day.toISOString(),
              dayGap: row.dayGap
            }))
          }
        })
      });
      await refreshBoard(weekStart, weekEnd);
      setPublishPreviewOpen(false);
      // Say who was actually told. A roster that silently misses somebody is
      // the failure this is meant to prevent, so the skipped names are named.
      const notified = published?.notified;
      const pushed = notified?.pushed ?? 0;
      if (!notified || (notified.emailed === 0 && pushed === 0 && notified.skipped.length === 0)) {
        setMessage('Draft roster published.');
      } else {
        const emailed = `${notified.emailed} ${notified.emailed === 1 ? 'person' : 'people'} emailed their shifts and calendar link`;
        // Devices, not people: one person can have the app on a phone and a
        // tablet, and saying "3 people notified" when it was one person's
        // three devices would overstate the reach.
        const buzzed = pushed > 0 ? `, buzzed ${pushed} device${pushed === 1 ? '' : 's'}` : '';
        setMessage(
          notified.skipped.length === 0
            ? `Published — ${emailed}${buzzed}.`
            : `Published — ${emailed}${buzzed}. Not told: ${notified.skipped.map((row) => `${row.name} (${row.reason})`).join(', ')}.`
        );
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not publish roster.');
    } finally {
      setSaving(false);
    }
  }

  async function duplicateShiftFromShift(shift: RosterShift) {
    setShiftContextMenu(null);
    setSaving(true);
    setMessage(null);
    setMessageTarget('shift-copy');
    try {
      await api('/api/staff/roster', {
        method: 'POST',
        body: JSON.stringify({
          staffProfileId: shift.staffProfileId,
          venue: shift.venue ?? shift.staffProfile?.venue ?? '',
          area: shift.area ?? '',
          roleTitle: shift.roleTitle ?? '',
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          breakMinutes: shift.breakMinutes,
          status: 'DRAFT',
          notes: shift.notes ?? ''
        })
      });
      await refreshBoard(weekStart, weekEnd);
      setMessage('Shift copied as a draft.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not copy shift.');
    } finally {
      setSaving(false);
    }
  }

  async function duplicateShift() {
    if (!editingShift) return;
    await duplicateShiftFromShift(editingShift);
  }

  function openShiftContextMenu(event: MouseEvent<HTMLElement>, shift: RosterShift) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 188;
    const menuHeight = 116;
    setShiftContextMenu({
      shift,
      x: Math.min(event.clientX, window.innerWidth - menuWidth - 12),
      y: Math.min(event.clientY, window.innerHeight - menuHeight - 12)
    });
  }

  // "Import from Deputy" now runs the same full Deputy auto-sync the admin
  // Integration Health page triggers (roster + employees + documents),
  // instead of the manual CSV paste flow.
  async function syncDeputyNow() {
    setSaving(true);
    setMessage(null);
    setMessageTarget('copy-week');
    try {
      const result = await api<{
        roster?: { shiftsCreated: number };
        employees?: { created: number; updated: number };
        documents?: { complianceCreated: number; reviewsCreated: number };
      }>('/api/integrations/deputy/sync-all', { method: 'POST' });
      const parts: string[] = [];
      if (result.roster) parts.push(`${result.roster.shiftsCreated} shifts`);
      if (result.employees) parts.push(`${result.employees.created} new staff, ${result.employees.updated} updated`);
      if (result.documents) parts.push(`${result.documents.complianceCreated + result.documents.reviewsCreated} docs`);
      await refreshBoard(weekStart, weekEnd);
      setMessage(`Deputy sync complete${parts.length ? ` — ${parts.join(', ')}` : ''}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not sync Deputy.');
    } finally {
      setSaving(false);
    }
  }

  async function copyPreviousWeek() {
    setSaving(true);
    setMessage(null);
    setMessageTarget('copy-week');
    try {
      const previousStart = addDays(weekStart, -7);
      const previousEnd = addDays(previousStart, boardDays);
      const payload = await api<RosterShift[]>(
        `/api/staff/roster?start=${encodeURIComponent(previousStart.toISOString())}&end=${encodeURIComponent(previousEnd.toISOString())}`
      );
      const existingKeys = new Set(
        roster.map((shift) => `${shift.staffProfileId}:${toDateInput(new Date(shift.startsAt))}:${toTimeInput(new Date(shift.startsAt))}`)
      );
      const shiftsToCopy = payload
        .filter((shift) => activeStaff.some((member) => member.id === shift.staffProfileId))
        .filter((shift) => {
          const startsAt = addDays(new Date(shift.startsAt), 7);
          const key = `${shift.staffProfileId}:${toDateInput(startsAt)}:${toTimeInput(startsAt)}`;
          return !existingKeys.has(key);
        });
      await Promise.all(
        shiftsToCopy.map((shift) => {
          const startsAt = addDays(new Date(shift.startsAt), 7);
          const endsAt = addDays(new Date(shift.endsAt), 7);
          return api('/api/staff/roster', {
            method: 'POST',
            body: JSON.stringify({
              staffProfileId: shift.staffProfileId,
              venue: shift.venue ?? shift.staffProfile?.venue ?? '',
              area: shift.area ?? '',
              roleTitle: shift.roleTitle ?? '',
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              breakMinutes: shift.breakMinutes,
              status: 'DRAFT',
              notes: shift.notes ?? ''
            })
          });
        })
      );
      await refreshBoard(weekStart, weekEnd);
      setMessage(shiftsToCopy.length ? `Copied ${shiftsToCopy.length} shifts from last week.` : 'No uncopied shifts found last week.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not copy last week.');
    } finally {
      setSaving(false);
    }
  }

  function scheduleRowVenue(row: (typeof scheduleRows)[number]) {
    if ('isVenueHeader' in row && row.isVenueHeader) return row.venue;
    return row.venue || row.member?.venue || (venueFilter !== 'all' ? venueFilter : '');
  }

  function toggleRowCollapsed(rowId: string) {
    setCollapsedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  }

  function toggleVenueCollapsed(venue: string) {
    setCollapsedVenues((prev) => {
      const next = new Set(prev);
      if (next.has(venue)) next.delete(venue); else next.add(venue);
      return next;
    });
  }

  /**
   * Click an empty cell, get a shift.
   *
   * Building a week meant opening the shift modal once per shift and
   * confirming it — sixty times for a full roster. Deputy's speed comes from
   * placing a shift on the click and correcting it after, so that is what this
   * does: the times carry over from the last shift placed, so a run of
   * identical shifts is a run of single clicks. The modal is still there for a
   * fully specified shift, and clicking an existing card still opens it.
   *
   * The same leave, closed-venue and double-booking guards as the modal apply.
   * Nothing is placed silently that the modal would have refused.
   */
  async function quickAddShift(row: (typeof scheduleRows)[number], day: Date) {
    if ('isVenueHeader' in row && row.isVenueHeader) {
      setMessage('Choose an area row under this venue before adding a shift.');
      return;
    }
    const targetVenue = scheduleRowVenue(row);
    if (isVenueClosedOnDate(targetVenue, day)) {
      setMessage(`${targetVenue || 'This venue'} is marked closed. Re-open that venue day before adding shifts.`);
      return;
    }

    const member = viewMode === 'team' && row.member
      ? row.member
      : activeStaff.find((m) => m.id === staffProfileId && (!row.venue || m.venue === row.venue))
        ?? activeStaff.find((m) => m.venue === row.venue)
        ?? activeStaff[0];
    if (!member) {
      setMessage('No one is available to roster here yet. Add a team member first.');
      return;
    }

    const range = shiftTimeRange(toDateInput(day), quickTimes.start, quickTimes.end);
    if (!range) {
      setMessage('Check the default shift times.');
      return;
    }

    // Same hard blocks the modal enforces — a faster path must not be a
    // looser one.
    const onLeave = leaveOverlays.find(
      (leave) => leave.staffProfileId === member.id
        && leave.status !== 'CANCELLED' && leave.status !== 'DECLINED'
        && leaveOverlapsDay(leave, range.startsAt)
    );
    if (onLeave) {
      setMessage(`${member.firstName} is on ${onLeave.type.toLowerCase().replace('_', ' ')} that day. Resolve the leave first.`);
      return;
    }
    const clash = shifts.find(
      (shift) => shift.staffProfileId === member.id
        && shift.status !== 'CANCELLED'
        && rangesOverlap(range.startsAt, range.endsAt, new Date(shift.startsAt), new Date(shift.endsAt))
    );
    if (clash) {
      setMessage(`${member.firstName} is already rostered ${timeOf(clash.startsAt)}–${timeOf(clash.endsAt)}. Pick another person or time.`);
      return;
    }

    const body = {
      staffProfileId: member.id,
      venue: row.venue || member.venue || '',
      area: (viewMode === 'team' ? area : row.area || row.label) || 'Floor',
      roleTitle: member.roleTitle || '',
      startsAt: range.startsAt.toISOString(),
      endsAt: range.endsAt.toISOString(),
      breakMinutes: Number(quickTimes.breakMinutes) || 0,
      status: 'DRAFT' as RosterShift['status'],
      notes: ''
    };
    const tempId = `pending-${Date.now()}`;
    const draft = {
      ...body,
      id: tempId,
      staffProfile: { id: member.id, firstName: member.firstName, lastName: member.lastName, roleTitle: member.roleTitle, venue: member.venue, employmentStatus: member.employmentStatus }
    } as RosterShift;

    setMessageTarget(null);
    const created = await optimistic(
      (current) => [...current, draft],
      () => api<RosterShift>('/api/staff/roster', { method: 'POST', body: JSON.stringify(body) }),
      (result, current) => current.map((s) => (s.id === tempId ? { ...s, ...result } : s))
    );
    if (created === null) return;

    const verdict = availabilityFor(member.id, range.startsAt, range.endsAt);
    setMessage(
      verdict.kind === 'AVAILABLE' || verdict.kind === 'NOT_STATED'
        ? `${member.firstName} · ${quickTimes.start}–${quickTimes.end}`
        : `${member.firstName} · ${quickTimes.start}–${quickTimes.end} — heads up, ${member.firstName} is ${verdict.detail}.`
    );
    setLastUndo({
      label: `Undo ${member.firstName}'s shift`,
      run: async () => {
        await optimistic(
          (current) => current.filter((s) => s.id !== created.id && s.id !== tempId),
          () => api(`/api/staff/roster/${created.id}`, { method: 'DELETE' })
        );
        setMessage('Shift removed.');
      }
    });
  }

  function prefillCell(row: (typeof scheduleRows)[number], day: Date) {
    if ('isVenueHeader' in row && row.isVenueHeader) {
      setMessage('Choose an area row under this venue before adding a shift.');
      return;
    }
    const targetVenue = scheduleRowVenue(row);
    if (isVenueClosedOnDate(targetVenue, day)) {
      setMessage(`${targetVenue || 'This venue'} is marked closed. Re-open that venue day before adding shifts.`);
      return;
    }
    setEditingShift(null);
    openShiftPanel();
    setDate(toDateInput(day));
    if (viewMode === 'team' && row.member) {
      setStaffProfileId(row.member.id);
      setShiftVenue(row.member.venue ?? '');
      setArea(area || 'Floor');
      setRoleTitle(row.member.roleTitle || '');
    } else {
      const memberForVenue =
        activeStaff.find((member) => member.id === staffProfileId && (!row.venue || member.venue === row.venue)) ??
        activeStaff.find((member) => member.venue === row.venue) ??
        activeStaff[0];
      setArea(row.area || row.label);
      setShiftVenue(row.venue || memberForVenue?.venue || '');
      setStaffProfileId(memberForVenue?.id ?? '');
      setRoleTitle(memberForVenue?.roleTitle ?? '');
    }
    setMessage('Shift details ready. Set the time and add shift.');
    setShiftStatus('DRAFT');
    setShiftNotes('');
  }

  function applyRosterRecommendation(row: { area: string; venue: string; gap: number; day?: Date; dayGap?: number }) {
    const dayGap = dailySummaries
      .map((summary) => ({
        day: summary.day,
        gap:
          summary.forecastCents > 0 && averageRateCents > 0
            ? summary.budgetCents / averageRateCents - summary.hours
            : 0
      }))
      .sort((a, b) => b.gap - a.gap)[0];
    const targetDay = row.day ?? (dayGap && dayGap.gap > 0 ? dayGap.day : days[0] ?? weekStart);
    const targetVenue = row.venue || (venueFilter === 'all' ? operationalVenues[0] ?? '' : venueFilter);
    const member =
      activeStaff.find((item) => item.venue === targetVenue && !isUnallocatedProfile(item)) ??
      activeStaff.find((item) => !isUnallocatedProfile(item)) ??
      activeStaff[0];
    const recommendedLength = Math.max(2, Math.min(5, Math.round(Math.abs(row.gap) * 2) / 2 || 4));
    const start = row.area.toLowerCase().includes('kitchen') ? '10:00' : '16:00';
    const endHour = Number(start.slice(0, 2)) + recommendedLength;

    setEditingShift(null);
    openShiftPanel();
    setDate(toDateInput(targetDay));
    setStartTime(start);
    setEndTime(`${String(Math.floor(endHour) % 24).padStart(2, '0')}:${endHour % 1 ? '30' : '00'}`);
    setArea(row.area);
    setShiftVenue(targetVenue);
    setStaffProfileId(member?.id ?? '');
    setRoleTitle(member?.roleTitle ?? row.area);
    setShiftStatus('DRAFT');
    setShiftNotes(`Recommended from forecast: ${row.gap > 0 ? 'add' : 'review'} ${Math.abs(row.gap).toFixed(1)}h for ${row.area}.`);
    setMessage('Recommendation loaded in the shift editor. Review and save it as a draft shift.');
  }

  async function moveShiftToCell(shift: RosterShift, row: (typeof scheduleRows)[number], day: Date) {
    const targetMember =
      viewMode === 'team' && row.member
        ? row.member
        : staff.find((member) => member.id === shift.staffProfileId);
    const targetArea = viewMode === 'area' ? row.area || row.label : shift.area ?? area;
    const targetVenue = viewMode === 'area' ? row.venue : targetMember?.venue ?? shift.venue ?? '';
    if (isVenueClosedOnDate(targetVenue, day)) {
      setMessage(`${targetVenue || 'This venue'} is marked closed. Re-open that venue day before moving shifts here.`);
      setDraggingShiftId(null);
      return;
    }
    const startsAt = moveDateKeepingTime(shift.startsAt, day);
    const endsAt = moveDateKeepingTime(shift.endsAt, day);
    const movedEndsAt =
      endsAt <= startsAt ? addDays(endsAt, 1) : endsAt;

    setMessage(null);
    const body = {
      staffProfileId: targetMember?.id ?? shift.staffProfileId,
      venue: targetVenue,
      area: targetArea,
      roleTitle: shift.roleTitle ?? targetMember?.roleTitle ?? '',
      startsAt: startsAt.toISOString(),
      endsAt: movedEndsAt.toISOString(),
      breakMinutes: shift.breakMinutes,
      status: shift.status,
      notes: shift.notes ?? ''
    };
    // The card lands where it was dropped on this frame. Waiting for a round
    // trip before the shift moves is what made dragging feel broken.
    const moved = await optimistic(
      (current) => current.map((s) => (s.id === shift.id
        ? { ...s, ...body, staffProfile: targetMember
            ? { id: targetMember.id, firstName: targetMember.firstName, lastName: targetMember.lastName, roleTitle: targetMember.roleTitle, venue: targetMember.venue, employmentStatus: targetMember.employmentStatus }
            : s.staffProfile } as RosterShift
        : s)),
      () => api<RosterShift>(`/api/staff/roster/${shift.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
      (result, current) => current.map((s) => (s.id === shift.id ? { ...s, ...result } : s))
    );
    setDraggingShiftId(null);
    if (moved !== null) {
      setMessage(`Moved shift to ${row.label} on ${day.toLocaleDateString(undefined, { weekday: 'short' })}.`);
    }
  }

  function handleDragStart(event: DragEvent<HTMLElement>, shift: RosterShift) {
    event.dataTransfer.setData('text/plain', shift.id);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingShiftId(shift.id);
  }

  function handleStaffBubbleDragStart(event: DragEvent<HTMLButtonElement>, member: StaffProfile) {
    event.dataTransfer.setData('text/plain', `staff:${member.id}`);
    event.dataTransfer.effectAllowed = 'copyMove';
    const ghost = document.createElement('div');
    ghost.textContent = `${member.firstName} ${member.lastName}`;
    ghost.style.cssText = 'position:fixed;top:-999px;left:-999px;padding:6px 14px;background:#fff;border:1.5px solid #d0d5dd;border-radius:20px;font-size:13px;font-weight:600;font-family:inherit;box-shadow:0 4px 12px rgba(0,0,0,0.15);white-space:nowrap;pointer-events:none;';
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }

  async function handleDropOnShift(event: DragEvent<HTMLElement>, shift: RosterShift) {
    event.preventDefault();
    event.stopPropagation();
    const data = event.dataTransfer.getData('text/plain');
    if (!data.startsWith('staff:')) return;
    const memberId = data.slice('staff:'.length);
    const member = staffById.get(memberId);
    if (!member) return;
    setMessage(null);
    const body = {
      staffProfileId: member.id,
      venue: member.venue ?? shift.venue,
      area: shift.area,
      roleTitle: member.roleTitle ?? shift.roleTitle ?? '',
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      breakMinutes: shift.breakMinutes,
      status: shift.status,
      notes: shift.notes ?? ''
    };
    const assigned = await optimistic(
      (current) => current.map((s) => (s.id === shift.id
        ? { ...s, ...body, staffProfile: { id: member.id, firstName: member.firstName, lastName: member.lastName, roleTitle: member.roleTitle, venue: member.venue, employmentStatus: member.employmentStatus } } as RosterShift
        : s)),
      () => api<RosterShift>(`/api/staff/roster/${shift.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
      (result, current) => current.map((s) => (s.id === shift.id ? { ...s, ...result } : s))
    );
    if (assigned !== null) setMessage(`Assigned ${member.firstName} ${member.lastName} to shift.`);
  }

  async function handleDrop(event: DragEvent<HTMLButtonElement>, row: (typeof scheduleRows)[number], day: Date) {
    event.preventDefault();
    const data = event.dataTransfer.getData('text/plain');
    // Staff bubble dropped onto an empty cell → open shift editor for that person
    if (data.startsWith('staff:')) {
      const memberId = data.slice('staff:'.length);
      const member = staffById.get(memberId);
      if (!member) return;
      openShiftPanel();
      setEditingShift(null);
      setDate(toDateInput(day));
      setStaffProfileId(member.id);
      setShiftVenue(member.venue ?? row.venue ?? '');
      setRoleTitle(member.roleTitle ?? '');
      setArea(row.area ?? area);
      setShiftStatus('DRAFT');
      return;
    }
    const shift = roster.find((item) => item.id === data);
    if (!shift) return;
    await moveShiftToCell(shift, row, day);
  }

  const activeFilterChips = [
    search.trim()
      ? {
          key: 'search',
          label: `Search: ${search.trim()}`,
          clear: () => setSearch('')
        }
      : null,
    venueFilter !== 'all'
      ? {
          key: 'venue',
          label: `Venue: ${venueFilter}`,
          clear: () => setVenueFilter('all')
        }
      : null,
    statusFilter !== 'all'
      ? {
          key: 'status',
          label: `Status: ${statusFilter.toLowerCase()}`,
          clear: () => setStatusFilter('all')
        }
      : null
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;
  const rosterRangeEnd = addDays(weekStart, boardDays - 1);
  const viewOptionsSummary = `${viewMode === 'team' ? 'Team member' : 'Area'} · ${boardDays === 7 ? 'Week' : '2 weeks'}`;
  const toolSummary = draftCount > 0 ? `${draftCount} draft${draftCount === 1 ? '' : 's'} ready` : 'Copy, review and publish';

  // Wage % of forecast revenue for the KPI strip
  const wagePercent = forecastSalesCents > 0
    ? ((rosterCostCents / forecastSalesCents) * 100)
    : null;
  const wageGuide = parsePercent(targetWagePercent);
  const wageTone: 'success' | 'warn' | 'danger' | 'neutral' = wagePercent == null
    ? 'neutral'
    : wagePercent > wageGuide + 2
      ? 'danger'
      : wagePercent > wageGuide
        ? 'warn'
        : 'success';

  // Forecast variance — how far off-guide we are as a percent. Drives the
  // red-down / green-up pill on the KPI strip and the tint on issue cards.
  const wageBudgetVariancePercent = wageBudgetCents > 0
    ? ((rosterCostCents - wageBudgetCents) / wageBudgetCents) * 100
    : null;
  const isOverBudget = (wageBudgetVariancePercent ?? 0) > 0;
  const isWayOverBudget = (wageBudgetVariancePercent ?? 0) > 10;
  const wageBudgetTone: 'success' | 'warn' | 'danger' | 'neutral' = wageBudgetVariancePercent == null
    ? 'neutral'
    : wageBudgetVariancePercent > 5
      ? 'danger'
      : wageBudgetVariancePercent > 0
        ? 'warn'
        : 'success';
  function formatVariance(pct: number | null): string {
    if (pct == null) return '—';
    if (Math.abs(pct) < 0.5) return '~ on budget';
    return `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
  }
  const coverageGap = draftCount === 0 && totalHours < recommendedHours - 2;

  return (
    <div className="page-stack">
      {/* Editorial roster header — eyebrow + Cormorant serif title + week nav */}
      <div className="alma-roster-header">
        <div className="alma-roster-header-titles">
          <span className="alma-roster-eyebrow">Staff · Roster</span>
          <div className="alma-roster-title-row">
            <span className="alma-roster-title">Week of</span>
            <span className="alma-roster-title is-italic">{formatRange(weekStart, rosterRangeEnd)}</span>
            <div className="alma-roster-weeknav">
              <button
                type="button"
                className="alma-roster-weeknav-btn"
                aria-label="Previous week"
                onClick={() => setRosterWeek(addDays(weekStart, -7))}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="15 6 9 12 15 18" />
                </svg>
              </button>
              <button
                type="button"
                className="alma-roster-weeknav-btn"
                aria-label="Next week"
                onClick={() => setRosterWeek(addDays(weekStart, 7))}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
              <button
                type="button"
                className="alma-roster-weeknav-btn alma-roster-weeknav-btn--text"
                onClick={() => {
                  const today = new Date();
                  setWeekStart(startOfWeek(today));
                  setDate(toDateInput(today));
                  setMobileSelectedDay(toDateInput(today));
                }}
              >
                This week
              </button>
              <button
                type="button"
                className="alma-roster-weeknav-btn alma-roster-weeknav-btn--text"
                disabled={saving}
                onClick={() => void syncDeputyNow()}
                title="Run a full Deputy sync now — pulls the latest roster, staff, and documents from Deputy."
              >
                Import from Deputy
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* The 5-card KPI strip used to live here. Everything it showed
          (planned hours, wage cost, wage %, drafts, status) is now in
          the forecast hairline + metric strip above the schedule grid,
          so this top block was wasting ~150px of vertical space without
          adding new information. */}

      {/* Editorial filter strip — search + venue + status + view mode + chips,
          all consolidated into one tidy row in the editorial chrome. The
          duplicate prev/next/today nav and Copy/Review/Publish buttons
          previously here are now handled by the editorial header above. */}
      <div className="alma-roster-toolbar">
        <div className="alma-roster-toolbar-search">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="16" y1="16" x2="21" y2="21" strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search team or area"
            aria-label="Search"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <Select
          aria-label="Venue"
          value={venueFilter}
          onChange={(event) => setVenueFilter(event.currentTarget.value)}
          options={[{ label: 'All venues', value: 'all' }, ...venues.map((venue) => ({ label: venue, value: venue }))]}
        />
        <Select
          aria-label="Status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.currentTarget.value as typeof statusFilter)}
          options={[
            { label: 'All statuses', value: 'all' },
            { label: 'Draft', value: 'DRAFT' },
            { label: 'Published', value: 'PUBLISHED' },
            { label: 'Completed', value: 'COMPLETED' },
            { label: 'Cancelled', value: 'CANCELLED' }
          ]}
        />
        <div className="alma-segmented" aria-label="Schedule view">
          <button type="button" className={viewMode === 'team' ? 'is-active' : ''} onClick={() => setViewMode('team')}>Team</button>
          <button type="button" className={viewMode === 'area' ? 'is-active' : ''} onClick={() => setViewMode('area')}>Area</button>
        </div>
        <div className="alma-segmented" aria-label="Roster range">
          <button type="button" className={boardDays === 7 ? 'is-active' : ''} onClick={() => setBoardDays(7)}>Week</button>
          <button type="button" className={boardDays === 14 ? 'is-active' : ''} onClick={() => setBoardDays(14)}>2w</button>
        </div>
      </div>

      {/* Action row — sits directly under the search/filter strip so
          the actions and the filters they operate on read as one
          control block. */}
      <div className="alma-roster-actions">
        {/* On phones every tool folds behind this one button so the action
            row is a single line: Tools + Publish. Desktop hides the toggle
            and the .alma-roster-tools wrapper renders display:contents, so
            the buttons lay out inline exactly as before. */}
        <div className="alma-roster-tools-wrap">
          <button
            type="button"
            className="alma-roster-tools-toggle"
            aria-haspopup="menu"
            aria-expanded={rosterToolsOpen}
            onClick={() => setRosterToolsOpen((open) => !open)}
          >
            Tools <span aria-hidden="true">▾</span>
          </button>
          {rosterToolsOpen ? (
            <button
              type="button"
              className="alma-roster-delete-backdrop"
              aria-label="Close roster tools"
              onClick={() => setRosterToolsOpen(false)}
            />
          ) : null}
          <div className={`alma-roster-tools ${rosterToolsOpen ? 'is-open' : ''}`}>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setRosterToolsOpen(false);
            newShift();
          }}
        >
          Add shift
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={saving}
          onClick={() => {
            setRosterToolsOpen(false);
            void copyPreviousWeek();
          }}
        >
          Copy last week
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setRosterToolsOpen(false);
            setHistoricalOpen(true);
          }}
          aria-label="Open historical forecast data"
        >
          Historical data{wageBudgetVariancePercent != null ? ` · ${formatVariance(wageBudgetVariancePercent)}` : ''}
        </Button>
        <label className="roster-forecast-inline roster-forecast-inline--utility" title="Forecast sales · target wage %">
          <span className="roster-forecast-inline-label">Forecast</span>
          <span className="roster-forecast-inline-prefix" aria-hidden="true">$</span>
          <input
            value={forecastSales}
            onChange={(event) => setForecastSales(event.currentTarget.value)}
            placeholder="Sales"
            aria-label="Weekly forecast sales"
          />
          <span className="forecast-sep">·</span>
          <input
            value={targetWagePercent}
            onChange={(event) => setTargetWagePercent(event.currentTarget.value)}
            placeholder="28"
            aria-label="Target wage %"
          />
          <span className="roster-forecast-inline-suffix" aria-hidden="true">%</span>
        </label>
        <div className="alma-roster-delete-controls" aria-label="Delete roster shifts">
          {/* Small red section button — delete a single area/section */}
          <div className="alma-roster-delete-wrap">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={saving || bulkDeleteAreas.length === 0}
              aria-haspopup="menu"
              aria-expanded={sectionMenuOpen}
              title="Delete a roster section"
              onClick={() => {
                setSectionMenuOpen((open) => !open);
                setDeleteMenuOpen(false);
              }}
            >
              Sections
            </Button>
            {sectionMenuOpen ? (
              <>
                <button
                  type="button"
                  className="alma-roster-delete-backdrop"
                  aria-label="Close section menu"
                  onClick={() => setSectionMenuOpen(false)}
                />
                <div className="alma-roster-delete-menu" role="menu">
                  <p className="alma-roster-delete-menu-head">Delete a section</p>
                  {bulkDeleteAreas.length === 0 ? (
                    <span className="alma-roster-delete-menu-empty">No sections to delete</span>
                  ) : (
                    bulkDeleteAreas.map((areaName) => (
                      <button
                        key={areaName}
                        type="button"
                        role="menuitem"
                        className="alma-roster-delete-menu-item is-danger"
                        onClick={() => void bulkDeleteRoster('area', areaName)}
                      >
                        {areaName}
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : null}
          </div>

          {/* Consolidated Delete dropdown — sits next to Publish */}
          <div className="alma-roster-delete-wrap">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={saving}
              aria-haspopup="menu"
              aria-expanded={deleteMenuOpen}
              rightIcon={<span aria-hidden="true">▾</span>}
              onClick={() => {
                setDeleteMenuOpen((open) => !open);
                setSectionMenuOpen(false);
              }}
            >
              Delete
            </Button>
            {deleteMenuOpen ? (
              <>
                <button
                  type="button"
                  className="alma-roster-delete-backdrop"
                  aria-label="Close delete menu"
                  onClick={() => setDeleteMenuOpen(false)}
                />
                <div className="alma-roster-delete-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="alma-roster-delete-menu-item"
                    disabled={visibleRoster.length === 0}
                    onClick={() => void bulkDeleteRoster('this-week')}
                  >
                    This week
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="alma-roster-delete-menu-item"
                    onClick={() => void bulkDeleteRoster('next-week')}
                  >
                    Next week
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="alma-roster-delete-menu-item"
                    disabled={visibleRoster.length === 0}
                    onClick={() => void bulkDeleteRoster('visible')}
                  >
                    Visible shifts
                  </button>
                  <div className="alma-roster-delete-menu-sep" />
                  <button
                    type="button"
                    role="menuitem"
                    className="alma-roster-delete-menu-item is-danger"
                    onClick={() => void bulkDeleteRoster('reset-all')}
                  >
                    Reset all data
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
          </div>
        </div>
        <button
          type="button"
          className="alma-roster-publish"
          disabled={saving || draftCount === 0}
          onClick={() => setPublishPreviewOpen(true)}
        >
          <span>Publish roster</span>
          {draftCount > 0 ? <span className="alma-roster-publish-sub">{draftCount} {draftCount === 1 ? 'change' : 'changes'}</span> : null}
        </button>
      </div>

      {activeFilterChips.length > 0 ? (
        <div className="alma-roster-active-chips" aria-label="Active roster filters">
          {activeFilterChips.map((chip) => (
            <button key={chip.key} type="button" onClick={chip.clear}>
              <span>{chip.label}</span>
              <span aria-hidden="true" className="alma-roster-active-chip-x">×</span>
            </button>
          ))}
        </div>
      ) : null}

      {messageTarget === 'copy-week' && message ? (
        <div className="alma-roster-toolbar-feedback">
          <ActionFeedback message={message} tone={message.includes('Could') ? 'error' : 'success'} />
        </div>
      ) : null}

      <ShiftClaimsPanel onDecided={reload} />

      {historicalOpen ? (
        <div
          className="alma-historical-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Historical data and forecast"
          onClick={(event) => {
            if (event.target === event.currentTarget) setHistoricalOpen(false);
          }}
        >
          <div className="alma-historical-modal-panel">
            <div className="alma-historical-modal-head">
              <div>
                <span className="alma-roster-eyebrow">Roster · Forecast</span>
                <h2 className="alma-historical-modal-title">Historical data</h2>
                <p className="alma-historical-modal-sub">
                  {formatCents(forecastSalesCents)} forecast · {forecastCostGapCents >= 0 ? 'Inside guide' : 'Over guide'}
                  {wageBudgetVariancePercent != null ? ` · ${formatVariance(wageBudgetVariancePercent)} vs budget` : ''}
                </p>
              </div>
              <button
                type="button"
                className="alma-historical-modal-close"
                aria-label="Close historical data"
                onClick={() => setHistoricalOpen(false)}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M3 3 L11 11 M11 3 L3 11" />
                </svg>
              </button>
            </div>
            <div className="alma-historical-modal-body">
        <div className="roster-historical-grid">
          {/* Left col: inputs + callout */}
          <div className="roster-historical-left">
            <div className="roster-historical-inputs">
              <Input
                label="Sales forecast"
                value={forecastSales}
                onChange={(event) => setForecastSales(event.currentTarget.value)}
                placeholder="$85,000"
              />
              <Input
                label="Wage target %"
                value={targetWagePercent}
                onChange={(event) => setTargetWagePercent(event.currentTarget.value)}
                placeholder="28"
              />
              <Button type="button" size="sm" variant="secondary" onClick={applyHistoricalForecast}>
                Use historical
              </Button>
              <ActionFeedback
                message={messageTarget === 'forecast' ? message : null}
                tone={message?.includes('Could') ? 'error' : 'success'}
              />
            </div>
            <div className={`roster-forecast-callout ${forecastCostGapCents >= 0 ? 'is-under' : ''}`}>
              <strong>{forecastCostGapCents >= 0 ? 'Inside wage guide' : 'Over wage guide'}</strong>
              <span>
                {forecastCostGapCents >= 0
                  ? `${formatCents(forecastCostGapCents)} remaining.`
                  : `${formatCents(Math.abs(forecastCostGapCents))} over guide.`}
              </span>
            </div>
            {missingRateStaff.length ? (
              <div className="roster-publish-guardrails">
                <strong>Pay rates missing</strong>
                <span>{missingRateStaff.map((m) => m.firstName).join(', ')}</span>
              </div>
            ) : null}
          </div>

          {/* Right col: metrics + day list */}
          <div className="roster-historical-right">
            <div className="roster-forecast-metrics roster-forecast-metrics-inline">
              <div><span>Forecast</span><strong>{formatCents(forecastSalesCents)}</strong></div>
              <div><span>Wage budget</span><strong>{formatCents(wageBudgetCents)}</strong></div>
              <div><span>Roster cost</span><strong>{formatCents(rosterCostCents)}</strong></div>
              <div><span>Gap</span><strong>{forecastHoursGap >= 0 ? `+${roundHours(forecastHoursGap)}` : roundHours(forecastHoursGap)}</strong></div>
            </div>
            <div className="roster-history-day-list roster-history-day-list-2col">
              {dailySummaries.map((summary) => (
                <label
                  key={summary.day.toISOString()}
                  className={summary.forecastCents > 0 && summary.plannedCostCents > summary.budgetCents ? 'is-over' : summary.forecastCents > 0 ? 'is-under' : ''}
                >
                  <span>{summary.day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</span>
                  <input
                    value={dailyForecastSales[toDateInput(summary.day)] ?? ''}
                    onChange={(event) => updateDailyForecast(summary.day, event.currentTarget.value)}
                    placeholder={String(Math.round((historicalDailyForecast[toDateInput(summary.day)] ?? 0) / 100))}
                  />
                  <small>{roundHours(summary.hours)} · {summary.wagePercent ? `${summary.wagePercent.toFixed(1)}%` : '—'}</small>
                </label>
              ))}
            </div>
          </div>
        </div>

        {areaGuidanceRows.length ? (
          <div className="roster-area-guidance roster-area-guidance-compact">
            <strong>Area guidance</strong>
            {areaGuidanceRows.map((row) => (
              <div key={`${row.venue}:${row.area}`}>
                <span>
                  <strong>{row.area}</strong>
                  <small>{row.venue} · {row.gap >= 0 ? `+${roundHours(row.gap)}` : roundHours(Math.abs(row.gap))}</small>
                </span>
                <small>{row.day.toLocaleDateString(undefined, { weekday: 'short' })}</small>
                <Button type="button" size="sm" variant="secondary" onClick={() => applyRosterRecommendation(row)}>
                  Apply
                </Button>
              </div>
            ))}
          </div>
        ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {message && !messageTarget ? (
        <div className="deputy-roster-summary">
          <span className="deputy-roster-message">{message}</span>
          {lastUndo ? (
            <button
              type="button"
              className="roster-undo-button"
              onClick={() => { const undo = lastUndo; setLastUndo(null); void undo.run(); }}
            >
              {lastUndo.label}
            </button>
          ) : null}
        </div>
      ) : null}

      {isMobileRoster ? (
        <div data-roster-view="mobile" className="mobile-roster-runtime">
          <MobileRosterView
            dailySummaries={dailySummaries}
            selectedDate={mobileSelectedDate}
            selectedSummary={mobileSelectedSummary}
            shifts={mobileDayShifts}
            venueGroups={mobileVenueGroups}
            venueLabel={venueFilter === 'all' ? 'All venues' : venueFilter}
            onSelectDay={setMobileSelectedDay}
            onAddShift={() => newShift(mobileSelectedDay)}
            onOpenShift={startEditShift}
          />

        </div>
      ) : null}

      {!isMobileRoster ? (
        <div data-roster-view="desktop" className={`deputy-roster-layout desktop-roster-surface ${sidePanelCollapsed ? 'is-side-collapsed' : 'is-side-open'}`}>
        <section className="deputy-schedule-panel" aria-label="Weekly roster grid">
          {/* One-line natural-language summary above the metric strip —
              the executive read; pills below are the breakdown. */}
          {(() => {
            if (forecastSalesCents === 0 && rosterCostCents === 0) return null;
            const targetPct = parsePercent(targetWagePercent);
            const wagePct = forecastSalesCents > 0 ? (rosterCostCents / forecastSalesCents) * 100 : null;
            const gap = wagePct != null ? wagePct - targetPct : null;
            const status = gap == null
              ? null
              : Math.abs(gap) < 0.5
                ? 'on target'
                : gap > 0
                  ? `${gap.toFixed(1)}% over target`
                  : `${Math.abs(gap).toFixed(1)}% under target`;
            return (
              <p className="roster-forecast-summary" aria-live="polite">
                {forecastSalesCents > 0 ? (
                  <>
                    Forecasting <strong>{formatCents(forecastSalesCents)}</strong>
                    {' · planning '}
                    <strong>{formatCents(rosterCostCents)}</strong>
                    {wagePct != null ? <> <em>({wagePct.toFixed(1)}%)</em></> : null}
                    {status ? <>{' · '}<em>{status}</em></> : null}
                  </>
                ) : (
                  <>
                    Planning <strong>{formatCents(rosterCostCents)}</strong>
                    {' · '}
                    <em>set a weekly forecast to see target variance</em>
                  </>
                )}
              </p>
            );
          })()}

          <div className="roster-board-command roster-board-command--inline" aria-label={`Roster board · ${boardDays === 7 ? '7 day' : '14 day'} · ${venueFilter === 'all' ? `${areaVenues.length} venues` : venueFilter}`}>
            <div className="roster-board-command-meta" aria-label="Roster board summary">
              <span><strong>{scheduleRows.filter((row) => !('isVenueHeader' in row && row.isVenueHeader)).length}</strong> rows</span>
              <span><strong>{visibleRoster.length}</strong> shifts</span>
              <span><strong>{roundHours(totalHours)}</strong></span>
              <span><strong>{publishedCount}</strong> live</span>
              {draftCount ? <span className="is-warning"><strong>{draftCount}</strong> drafts</span> : null}
              {(() => {
                const wagePct = forecastSalesCents > 0 ? (rosterCostCents / forecastSalesCents) * 100 : null;
                const targetPct = parsePercent(targetWagePercent);
                const overBudget = wageBudgetCents > 0 && rosterCostCents > wageBudgetCents;
                const tone = wagePct == null ? 'neutral' : overBudget ? 'danger' : wagePct > targetPct * 0.92 ? 'warning' : 'positive';
                return (
                  <span className={`roster-cost-forecast-pill is-${tone}`} title="Projected labour cost vs target wage budget">
                    <span>Labour</span>
                    <strong>{formatCents(rosterCostCents)}</strong>
                    {wagePct !== null ? (
                      <span className="roster-cost-forecast-pct">{wagePct.toFixed(1)}%</span>
                    ) : null}
                    {wageBudgetCents > 0 ? (
                      <small>
                        {overBudget ? '▲' : '▼'} {formatCents(Math.abs(forecastCostGapCents))} {overBudget ? 'over' : 'under'} budget
                      </small>
                    ) : null}
                  </span>
                );
              })()}
              {!sidePanelCollapsed ? (
                <span className="roster-board-command-staff-inline">
                  <span className="roster-right-rail-title">Staff</span>
                  <button
                    type="button"
                    className="roster-board-command-staff-collapse"
                    onClick={() => setSidePanelCollapsed(true)}
                    aria-label="Collapse Staff rail"
                  >
                    Collapse
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="roster-board-command-staff-inline roster-board-command-staff-inline--expand"
                  onClick={() => setSidePanelCollapsed(false)}
                  aria-label="Expand Staff rail"
                >
                  <span className="roster-right-rail-title">Staff</span>
                  <span>Expand</span>
                </button>
              )}
            </div>
          </div>
          <div className={`deputy-schedule-grid roster-days-${boardDays} is-venue-separated`} style={scheduleGridStyle}>
            {/* The global day-head and day-summary rows are gone — each
                venue now carries its own day labels + per-day summary
                in the venue header row beneath. No group total at the
                top until we add a per-venue comparison view.

                What stays is a slim week stepper, so you can jump a week
                either way without scrolling back up to the page header. */}
            <div className="deputy-board-weeknav">
              <div className="deputy-board-weeknav-steps">
                <button
                  type="button"
                  className="deputy-board-weeknav-btn"
                  aria-label="Previous week"
                  onClick={() => setRosterWeek(addDays(weekStart, -7))}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 6 9 12 15 18" /></svg>
                </button>
                <button
                  type="button"
                  className="deputy-board-weeknav-btn"
                  aria-label="Next week"
                  onClick={() => setRosterWeek(addDays(weekStart, 7))}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>
                </button>
              </div>
              <span className="deputy-board-weeknav-range">{formatRange(weekStart, rosterRangeEnd)}</span>
              {sameDay(weekStart, startOfWeek(new Date())) ? (
                <span className="deputy-board-weeknav-now">This week</span>
              ) : (
                <button
                  type="button"
                  className="deputy-board-weeknav-btn deputy-board-weeknav-btn--text"
                  onClick={() => {
                    const today = new Date();
                    setRosterWeek(startOfWeek(today));
                    setMobileSelectedDay(toDateInput(today));
                  }}
                >
                  Back to this week
                </button>
              )}
            </div>

            {scheduleRows.length === 0 ? (
              <div className="deputy-schedule-empty">No rows match the current filters.</div>
            ) : (
              scheduleRows.map((row) => {
                if ('isVenueHeader' in row && row.isVenueHeader) {
                  const venueCollapsed = collapsedVenues.has(row.venue);
                  return (
                    <div className="deputy-schedule-row deputy-venue-row" key={row.id}>
                      <div
                        className="deputy-row-label deputy-venue-label"
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleVenueCollapsed(row.venue)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleVenueCollapsed(row.venue); } }}
                        title={venueCollapsed ? 'Expand venue' : 'Collapse venue'}
                      >
                        <span className="deputy-venue-eyebrow">Venue</span>
                        <strong>{row.label}</strong>
                      </div>
                      {days.map((day) => {
                        // Per-venue daily summary in the same style as the
                        // top global summary strip — hours / cost / wage%
                        // scoped to this venue. The top strip aggregates
                        // these across all venues, so they're not double
                        // counted in any downstream total.
                        const dayShifts = row.shifts.filter((shift) => sameDay(new Date(shift.startsAt), day));
                        const dayHours = dayShifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
                        const dayCostCents = dayShifts.reduce((sum, shift) => {
                          const member = shift.staffProfileId ? staffById.get(shift.staffProfileId) : undefined;
                          const rateCents = (member ? rosterHourlyRateCents(member) : null) ?? averageRateCents;
                          return sum + Math.round(shiftHours(shift) * rateCents);
                        }, 0);
                        const isClosed = isVenueClosedOnDate(row.venue, day);
                        const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                        const venueForecastCents = baselineSalesCentsForDate(row.venue, day);
                        const wagePercent = venueForecastCents > 0 ? (dayCostCents / venueForecastCents) * 100 : 0;
                        const isOver = venueForecastCents > 0 && dayCostCents > Math.round(venueForecastCents * targetWagePercentParsed);
                        const hasCost = !isClosed && dayCostCents > 0;
                        const isTodayCell = sameDay(day, new Date());
                        return (
                          <div
                            key={`${row.id}-${day.toISOString()}`}
                            className={`deputy-schedule-cell deputy-venue-cell ${isClosed ? 'is-closed' : ''} ${isWeekend ? 'is-weekend' : ''} ${isTodayCell ? 'is-today' : ''}`}
                          >
                            {/* Day label folds INTO the venue cell so each
                                venue's section is self-contained. */}
                            <span className="deputy-venue-cell-day">
                              <strong>{day.toLocaleDateString(undefined, { weekday: 'short' })}</strong>
                              <em>{day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</em>
                            </span>
                            {isClosed ? (
                              <span className="deputy-venue-cell-closed">Closed</span>
                            ) : (
                              <>
                                <span className="deputy-venue-cell-hours">{roundHours(dayHours)}</span>
                                {hasCost ? (
                                  <>
                                    <span className="deputy-venue-cell-cost">{formatCents(dayCostCents)}</span>
                                    {wagePercent > 0 ? (
                                      <span className={`deputy-venue-cell-pct ${isOver ? 'is-over' : 'is-under'}`}>
                                        {wagePercent.toFixed(0)}%
                                      </span>
                                    ) : null}
                                  </>
                                ) : null}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                }
                // Skip rows whose venue section is collapsed
                if (collapsedVenues.has(row.venue)) return null;
                const isRowCollapsed = collapsedRowIds.has(row.id);
                return (
                  <div className="deputy-schedule-row" key={row.id}>
                    <div
                      className={`deputy-row-label${isRowCollapsed ? ' is-row-collapsed' : ''}`}
                      role="button"
                      tabIndex={0}
                      title={isRowCollapsed ? 'Expand row' : 'Collapse row'}
                      onClick={() => toggleRowCollapsed(row.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRowCollapsed(row.id); } }}
                      style={{ cursor: 'pointer' }}
                    >
                      <span className="row-collapse-toggle" aria-hidden>
                        {isRowCollapsed ? '▸' : '▾'}
                      </span>
                      <span className="roster-avatar small">{row.initials}</span>
                      <strong>{row.label}</strong>
                    </div>
                    {days.map((day) => {
                      const cellShifts = row.shifts.filter((shift) => sameDay(new Date(shift.startsAt), day));
                      const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                      // Match leave on this staff member for this day
                      const memberLeave = row.member
                        ? leaveOverlays.find((l) => l.staffProfileId === row.member!.id && leaveOverlapsDay(l, day))
                        : null;
                      if (isRowCollapsed) {
                        return (
                          <button
                            key={`${row.id}-${day.toISOString()}`}
                            type="button"
                            className={`deputy-schedule-cell is-row-collapsed${memberLeave ? ' has-leave' : ''}${isWeekend ? ' is-weekend' : ''}`}
                            onClick={() => {
                              toggleRowCollapsed(row.id);
                              prefillCell(row, day);
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(event) => {
                              toggleRowCollapsed(row.id);
                              void handleDrop(event, row, day);
                            }}
                          >
                            {cellShifts.length > 0 ? <span className="collapsed-shift-count">{cellShifts.length}</span> : null}
                          </button>
                        );
                      }
                      const isClosed = isVenueClosedOnDate(scheduleRowVenue(row), day);
                      return (
                        <button
                          key={`${row.id}-${day.toISOString()}`}
                          type="button"
                          className={`deputy-schedule-cell ${cellShifts.length ? 'has-shifts' : ''} ${isClosed ? 'is-closed' : ''}${memberLeave ? ` has-leave is-leave-${memberLeave.status.toLowerCase()}` : ''}${isWeekend ? ' is-weekend' : ''}`}
                          aria-disabled={isClosed}
                          onClick={() => void quickAddShift(row, day)}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                          }}
                          onDrop={(event) => void handleDrop(event, row, day)}
                        >
                          {isClosed ? (
                            <span className="deputy-closed-cell">
                              Closed
                              {cellShifts.length ? <small>{cellShifts.length}</small> : null}
                            </span>
                          ) : null}
                          {memberLeave && !isClosed ? (
                            <span className={`deputy-leave-overlay is-${memberLeave.status.toLowerCase()}`} title={`${leaveTypeLabel(memberLeave.type)} · ${memberLeave.status.toLowerCase()}`}>
                              {memberLeave.status === 'APPROVED' ? '✓' : '⏳'}
                              <small>{leaveTypeLabel(memberLeave.type).split(' ')[0]}</small>
                            </span>
                          ) : null}
                          {!isClosed && cellShifts.length === 0 ? <span className="deputy-add-shift">+ Shift</span> : null}
                          {!isClosed ? cellShifts.map((shift) => (
                            <span
                              key={shift.id}
                              draggable
                              role="button"
                              tabIndex={0}
                              className={`deputy-shift-card deputy-shift-${shift.status.toLowerCase()} ${isDeputyImportedShift(shift) ? 'is-deputy-import' : ''} ${isOpenShift(shift) ? 'is-unallocated' : ''} ${draggingShiftId === shift.id ? 'is-dragging' : ''} ${staffDropTargetShiftId === shift.id ? 'is-staff-drop-target' : ''} ${fatigueByShift.has(shift.id) ? 'has-fatigue' : ''}`}
                              title={fatigueByShift.get(shift.id)?.map((w) => w.message).join('\n')}
                              style={areaStyle(shift.area || row.label)}
                              onDragStart={(event) => handleDragStart(event, shift)}
                              onDragEnd={() => setDraggingShiftId(null)}
                              onDragOver={(event) => {
                                if (event.dataTransfer.types.includes('text/plain')) {
                                  event.preventDefault();
                                  setStaffDropTargetShiftId(shift.id);
                                }
                              }}
                              onDragLeave={() => setStaffDropTargetShiftId(null)}
                              onDrop={(event) => { setStaffDropTargetShiftId(null); void handleDropOnShift(event, shift); }}
                              onClick={(event) => {
                                event.stopPropagation();
                                startEditShift(shift);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                event.preventDefault();
                                event.stopPropagation();
                                startEditShift(shift);
                              }}
                              onContextMenu={(event) => openShiftContextMenu(event, shift)}
                            >
                              <span className="deputy-shift-topline">
                                <strong>{timeOf(shift.startsAt)}-{timeOf(shift.endsAt)}</strong>
                                {fatigueByShift.has(shift.id) ? (
                                  <em
                                    className="deputy-shift-fatigue-flag"
                                    aria-label={fatigueByShift.get(shift.id)!.map((w) => w.message).join(' ')}
                                  >
                                    !
                                  </em>
                                ) : null}
                                <em className={`deputy-shift-status-pill is-${shift.status.toLowerCase()}`}>
                                  {shift.status === 'PUBLISHED' ? 'Live' : shift.status.toLowerCase()}
                                </em>
                              </span>
                              {isUnallocatedProfile(shift.staffProfile) ? (
                                <>
                                  <span className="deputy-shift-person deputy-shift-needs-staff">Needs staff</span>
                                  <small className="deputy-shift-assign-hint">+ Assign</small>
                                </>
                              ) : (
                                <>
                                  <span className="deputy-shift-person">
                                    {viewMode === 'team' ? (
                                      shift.area || shift.roleTitle || 'Shift'
                                    ) : (
                                      <>
                                        {shift.staffProfile ? (
                                          <span className="deputy-shift-avatar" aria-hidden>{staffInitials(shift.staffProfile)}</span>
                                        ) : null}
                                        {`${shift.staffProfile?.firstName ?? ''} ${shift.staffProfile?.lastName ?? ''}`.trim()}
                                      </>
                                    )}
                                  </span>
                                  <small>
                                    {shift.breakMinutes ? `${shift.breakMinutes}m break` : shift.status}
                                  </small>
                                </>
                              )}
                            </span>
                          )) : null}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <aside className={`roster-right-rail ${sidePanelCollapsed ? 'is-collapsed' : ''}`}>
          {sidePanelCollapsed ? (
            <div className="roster-right-rail-collapsed">
              <button
                type="button"
                onClick={() => {
                  setSidePanelCollapsed(false);
                  setSidePanelMode('staff');
                }}
              >
                Staff
              </button>
              <button
                type="button"
                onClick={() => {
                  setSidePanelCollapsed(false);
                  setSidePanelMode('history');
                }}
              >
                History
              </button>
            </div>
          ) : (
            <>
              {false ? (
                <Card
                  className="roster-side-card roster-history-panel"
                  title="Historical data"
                  subtitle="Forecast inputs, wage budget and suggested roster gaps."
                >
                  <div className="roster-history-actions">
                    <Button type="button" size="sm" variant="secondary" onClick={applyHistoricalForecast}>
                      Use historical
                    </Button>
                    <ActionFeedback
                      message={messageTarget === 'forecast' ? message : null}
                      tone={message?.includes('Could') ? 'error' : 'success'}
                    />
                  </div>
                  <Input
                    label="Weekly sales override"
                    value={forecastSales}
                    onChange={(event) => setForecastSales(event.currentTarget.value)}
                    placeholder="$85,000"
                  />
                  <Input
                    label="Target wage %"
                    value={targetWagePercent}
                    onChange={(event) => setTargetWagePercent(event.currentTarget.value)}
                    placeholder="28"
                  />
                  <p className="subtle roster-forecast-source">
                    Baseline from {engineOutlook ? 'the live forecast engine (your own trading history, bookings-aware)' : 'previous years'}: {formatCents(historicalForecastSalesCents)} across {forecastVenues.length || 1} venue{forecastVenues.length === 1 ? '' : 's'}.
                  </p>
                  <div className="roster-forecast-metrics roster-forecast-metrics-compact">
                    <div>
                      <span>
                        Forecast sales
                        {dailyForecastTotalCents === 0 &&
                        parseMoneyCents(forecastSales) === 0 &&
                        historicalForecastSalesCents > 0 ? (
                          <span
                            className="subtle"
                            style={{ marginLeft: 6, fontWeight: 400 }}
                            title="No manual forecast entered — using the baseline from previous years."
                          >
                            (historical)
                          </span>
                        ) : null}
                      </span>
                      <strong>{formatCents(forecastSalesCents)}</strong>
                    </div>
                    <div>
                      <span>Wage budget</span>
                      <strong>{formatCents(wageBudgetCents)}</strong>
                    </div>
                    <div>
                      <span>Roster cost</span>
                      <strong>{formatCents(rosterCostCents)}</strong>
                    </div>
                    <div>
                      <span>Guidance</span>
                      <strong>{forecastHoursGap >= 0 ? `+${roundHours(forecastHoursGap)}` : roundHours(forecastHoursGap)}</strong>
                    </div>
                  </div>
                  <div className={`roster-forecast-callout ${forecastCostGapCents >= 0 ? 'is-under' : ''}`}>
                    <strong>{forecastCostGapCents >= 0 ? 'Inside wage guide' : 'Over wage guide'}</strong>
                    <span>
                      {forecastCostGapCents >= 0
                        ? `${formatCents(forecastCostGapCents)} remaining against forecast.`
                        : `${formatCents(Math.abs(forecastCostGapCents))} over the current wage guide.`}
                    </span>
                  </div>
                  <div className="roster-history-day-list">
                    {dailySummaries.map((summary) => (
                      <label
                        key={summary.day.toISOString()}
                        className={summary.forecastCents > 0 && summary.plannedCostCents > summary.budgetCents ? 'is-over' : summary.forecastCents > 0 ? 'is-under' : ''}
                      >
                        <span>{summary.day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</span>
                        <input
                          value={dailyForecastSales[toDateInput(summary.day)] ?? ''}
                          onChange={(event) => updateDailyForecast(summary.day, event.currentTarget.value)}
                          placeholder={String(Math.round((historicalDailyForecast[toDateInput(summary.day)] ?? 0) / 100))}
                        />
                        <small>{roundHours(summary.hours)} · {summary.wagePercent ? `${summary.wagePercent.toFixed(1)}%` : 'No sales'}</small>
                      </label>
                    ))}
                  </div>
                  {venueForecastRows.length ? (
                    <div className="roster-venue-forecast roster-venue-forecast-compact">
                      {venueForecastRows.map((row) => (
                        <div key={row.venue}>
                          <span>
                            <strong>{row.venue}</strong>
                            <small>{row.source ? `Historical source: ${row.source}` : 'No historical source'}</small>
                          </span>
                          <span>
                            <strong>{roundHours(row.plannedHours)}</strong>
                            <small>planned</small>
                          </span>
                          <span>
                            <strong>{row.hoursGap >= 0 ? `+${roundHours(row.hoursGap)}` : roundHours(row.hoursGap)}</strong>
                            <small>gap</small>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {missingRateStaff.length ? (
                    <div className="roster-publish-guardrails">
                      <strong>Pay rates missing</strong>
                      <span>{missingRateStaff.map((member) => `${member.firstName} ${member.lastName}`).join(', ')}</span>
                    </div>
                  ) : null}
                  {areaGuidanceRows.length ? (
                    <div className="roster-area-guidance roster-area-guidance-compact">
                      <strong>Area guidance</strong>
                      {areaGuidanceRows.map((row) => (
                        <div key={`${row.venue}:${row.area}`}>
                          <span>
                            <strong>{row.area}</strong>
                            <small>{row.venue} · {row.gap >= 0 ? `add ${roundHours(row.gap)}` : `review ${roundHours(Math.abs(row.gap))}`}</small>
                          </span>
                          <small>{row.day.toLocaleDateString(undefined, { weekday: 'short' })}</small>
                          <Button type="button" size="sm" variant="secondary" onClick={() => applyRosterRecommendation(row)}>
                            Apply
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </Card>
              ) : (
                <Card
                  className="roster-side-card"
                >
                  {(() => {
                    // Roster Redesign 1C: "Needs filling" queue — every unallocated
                    // shift this week as a prioritised, one-tap list.
                    const openShifts = visibleRoster
                      .filter((shift) => isOpenShift(shift) && shift.status !== 'CANCELLED')
                      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
                    if (!openShifts.length) return null;
                    return (
                      <div className="roster-fill-queue">
                        <div className="roster-fill-queue-head">
                          <strong>Needs filling</strong>
                          <span>{openShifts.length} shift{openShifts.length === 1 ? '' : 's'}</span>
                        </div>
                        {openShifts.map((shift) => (
                          <button
                            key={shift.id}
                            type="button"
                            className="roster-fill-queue-card"
                            style={areaStyle(shift.area || '')}
                            onClick={() => startEditShift(shift)}
                          >
                            <span className="roster-fill-queue-meta">
                              <span className="dot" aria-hidden />
                              <strong>{shift.area || shift.roleTitle || 'Shift'}</strong>
                              <small>
                                {new Date(shift.startsAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
                                {' · '}
                                {timeOf(shift.startsAt)}–{timeOf(shift.endsAt)}
                              </small>
                            </span>
                            <span className="roster-fill-queue-assign">Assign</span>
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                  <div className="roster-side-staff-list">
                    {sidePanelStaff.length ? sidePanelStaff.map((member) => {
                      const memberShifts = visibleRoster.filter((shift) => shift.staffProfileId === member.id);
                      const memberHours = memberShifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
                      const memberRateCents = rosterHourlyRateCents(member) ?? averageRateCents;
                      const memberWeekCost = Math.round(memberHours * memberRateCents);
                      const rateLabel = memberRateCents ? `$${(memberRateCents / 100).toFixed(2)}/hr` : 'No rate set';
                      const costLabel = memberWeekCost > 0 ? ` · $${(memberWeekCost / 100).toFixed(2)} this week` : '';
                      const fullName = `${member.firstName} ${member.lastName}`;
                      const isLongName = fullName.length > 18;
                      return (
                        <button
                          type="button"
                          key={member.id}
                          draggable
                          className={`roster-staff-bubble ${staffProfileId === member.id ? 'is-selected' : ''}${isLongName ? ' is-long-name' : ''}`}
                          onDragStart={(event) => handleStaffBubbleDragStart(event, member)}
                          onMouseEnter={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setStaffCardHover({
                              member,
                              memberShifts,
                              memberHours,
                              rateLabel,
                              costLabel,
                              x: rect.left,
                              y: rect.top + rect.height / 2,
                            });
                          }}
                          onMouseLeave={() => setStaffCardHover(null)}
                          onClick={() => {
                            setStaffProfileId(member.id);
                            setShiftVenue(member.venue ?? '');
                            setRoleTitle(member.roleTitle ?? '');
                          }}
                        >
                          <span className="roster-avatar">{fullName}</span>
                          {memberShifts.length > 0 ? (
                            <span className="roster-staff-bubble-shifts">{memberShifts.length}</span>
                          ) : null}
                        </button>
                      );
                    }) : (
                      <EmptyState title="No staff match this venue" description="Switch venue filters to see the full team." />
                    )}
                  </div>
                </Card>
              )}
            </>
          )}
        </aside>
        </div>
      ) : null}
      {editorOpen ? (
        <div
          className="roster-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeShiftPanel();
          }}
        >
          <section
            className="roster-shift-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="roster-shift-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="roster-shift-modal-header">
              <div>
                <p className="eyebrow">{editingShift ? 'Edit shift' : 'New shift'}</p>
                <h2 id="roster-shift-modal-title">{editingShift ? `${editingShift.area || 'Shift'} · ${timeOf(editingShift.startsAt)}–${timeOf(editingShift.endsAt)}` : 'Add a shift'}</h2>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={closeShiftPanel}>Close</Button>
            </header>
            <div className="staff-profile-form roster-shift-modal-form">
              <div className="form-grid two">
                <Select
                  label="Team member"
                  value={staffProfileId}
                  onChange={(event) => setStaffProfileId(event.currentTarget.value)}
                  options={sortStaffForSelect(activeStaff).map((member) => ({
                    label: `${member.firstName} ${member.lastName}`,
                    value: member.id
                  }))}
                />
                <Select
                  label="Venue"
                  value={shiftVenue}
                  onChange={(event) => setShiftVenue(event.currentTarget.value)}
                  options={venues.map((venue) => ({ label: venue, value: venue }))}
                />
              </div>
              <div className="form-grid two">
                <Select
                  label="Area"
                  value={area}
                  onChange={(event) => setArea(event.currentTarget.value)}
                  options={areaSelectOptions}
                />
                <Input label="Role" value={roleTitle} onChange={(event) => setRoleTitle(event.currentTarget.value)} placeholder="Use profile role" />
              </div>
              <div className="form-grid two">
                <Input label="Date" type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} />
                <Select
                  label="Status"
                  value={shiftStatus}
                  onChange={(event) => setShiftStatus(event.currentTarget.value as RosterShift['status'])}
                  options={[
                    { label: 'Draft', value: 'DRAFT' },
                    { label: 'Published', value: 'PUBLISHED' },
                    { label: 'Completed', value: 'COMPLETED' },
                    { label: 'Cancelled', value: 'CANCELLED' }
                  ]}
                />
              </div>
              <div className="form-grid two">
                <Input label="Start" type="time" value={startTime} onChange={(event) => setStartTime(event.currentTarget.value)} />
                <Input label="End" type="time" value={endTime} onChange={(event) => setEndTime(event.currentTarget.value)} />
              </div>
              {selectedShiftHours ? (
                <p className="subtle roster-duration-hint">
                  {roundHours((selectedShiftHours.endsAt.getTime() - selectedShiftHours.startsAt.getTime()) / 36e5)} shift
                  {selectedShiftHours.endsAt.getDate() !== selectedShiftHours.startsAt.getDate() ? ' · overnight' : ''}
                </p>
              ) : null}
              {shiftLeaveClashes.length > 0 ? (
                <div className="roster-conflict-warning is-blocking">
                  <strong>On leave this day · save blocked</strong>
                  <span>
                    {shiftLeaveClashes
                      .slice(0, 2)
                      .map((leave) => `${leave.type.toLowerCase().replace('_', ' ')}${leave.status === 'PENDING' ? ' (pending)' : ''}`)
                      .join(', ')}
                  </span>
                </div>
              ) : null}
              {shiftConflicts.length > 0 ? (
                <div className="roster-conflict-warning is-blocking">
                  <strong>Already rostered · save blocked</strong>
                  <span>
                    {shiftConflicts
                      .slice(0, 2)
                      .map((shift) => `${timeOf(shift.startsAt)}-${timeOf(shift.endsAt)} ${shift.venue || shift.area || 'Shift'}`)
                      .join(', ')}
                  </span>
                </div>
              ) : null}
              <div className="form-grid two">
                <Input label="Meal break (min)" type="number" min="0" step="5" value={breakMinutes} onChange={(event) => setBreakMinutes(event.currentTarget.value)} />
              </div>
              <Textarea label="Notes" rows={2} value={shiftNotes} onChange={(event) => setShiftNotes(event.currentTarget.value)} />
            </div>
            <footer className="roster-shift-modal-footer">
              {editingShift ? (
                <>
                  <Button type="button" variant="secondary" disabled={saving} onClick={() => void duplicateShift()}>
                    Duplicate
                  </Button>
                  <Button type="button" variant="ghost" disabled={saving} onClick={() => void deleteShift(editingShift)}>
                    Delete
                  </Button>
                </>
              ) : null}
              <span style={{ flex: 1 }} />
              <ActionFeedback
                message={messageTarget === 'shift-save' || messageTarget === 'shift-copy' || messageTarget === 'shift-delete' ? message : null}
                tone={message?.includes('Could') || message?.includes('Choose') || message?.includes('Check') ? 'error' : 'success'}
              />
              <Button type="button" disabled={saving || !canSaveShift} onClick={() => void saveShift()}>
                {saving ? 'Saving…' : editingShift ? 'Save shift' : 'Add shift'}
              </Button>
            </footer>
          </section>
        </div>
      ) : null}
      {publishPreviewOpen ? (
        <div
          className="roster-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPublishPreviewOpen(false);
          }}
        >
          <section
            className="roster-publish-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="roster-publish-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="roster-publish-modal-header">
              <div>
                <p className="eyebrow">Publish shifts</p>
                <h2 id="roster-publish-title">Publish roster</h2>
                <p className="subtle">
                  Review draft shifts and guardrails before staff see this roster.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPublishPreviewOpen(false)}>
                Close
              </Button>
            </header>
            <div className="roster-publish-modal-summary">
              <div>
                <span>Draft shifts</span>
                <strong>{draftCount}</strong>
              </div>
              <div>
                <span>Roster cost</span>
                <strong>{formatCents(rosterCostCents)}</strong>
              </div>
              <div>
                <span>Wage guide</span>
                <strong>{formatCents(wageBudgetCents)}</strong>
              </div>
              <div>
                <span>Hours gap</span>
                <strong>{forecastHoursGap >= 0 ? `+${roundHours(forecastHoursGap)}` : roundHours(forecastHoursGap)}</strong>
              </div>
            </div>
            <div className="roster-publish-modal-body">
              <div>
                <div className="roster-modal-section-head">
                  <h3>Draft shifts</h3>
                  <span>{formatRange(weekStart, addDays(weekStart, boardDays - 1))}</span>
                </div>
                <div className="publish-preview-list">
                  {publishableDrafts.length ? publishableDrafts.map((shift) => (
                    <button
                      key={shift.id}
                      type="button"
                      className="publish-preview-row"
                      onClick={() => {
                        setPublishPreviewOpen(false);
                        startEditShift(shift);
                      }}
                    >
                      <span>
                        <strong>{new Date(shift.startsAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</strong>
                        <small>{timeOf(shift.startsAt)}-{timeOf(shift.endsAt)} · {shift.area || shift.roleTitle || 'Shift'}</small>
                      </span>
                      <span>
                        <strong>{shift.staffProfile?.firstName ?? 'Unallocated'} {shift.staffProfile?.lastName ?? ''}</strong>
                        <small>{shift.venue || shift.staffProfile?.venue || 'No venue set'}</small>
                      </span>
                      <Badge tone={isOpenShift(shift) ? 'warning' : 'info'}>
                        {roundHours(shiftHours(shift))}
                      </Badge>
                    </button>
                  )) : (
                    <EmptyState title="No draft shifts" description="There is nothing ready to publish in this roster view." />
                  )}
                </div>
              </div>
              <div>
                <div className={`roster-publish-guardrails ${publishWarnings.length ? '' : 'is-clear'}`}>
                  <strong>{publishWarnings.length ? 'Check before publishing' : 'Ready to publish'}</strong>
                  {publishWarnings.length ? publishWarnings.map((warning) => (
                    <span key={warning}>{warning}</span>
                  )) : (
                    <span>No roster warnings for this view.</span>
                  )}
                </div>
                <div className={`roster-forecast-callout ${forecastCostGapCents >= 0 ? 'is-under' : ''}`}>
                  <strong>{forecastCostGapCents >= 0 ? 'Inside forecast' : 'Over forecast'}</strong>
                  <span>
                    {forecastCostGapCents >= 0
                      ? `${formatCents(forecastCostGapCents)} wage budget remaining.`
                      : `${formatCents(Math.abs(forecastCostGapCents))} above the wage guide.`}
                  </span>
                </div>
                <div className="roster-publish-modal-actions">
                  <Button type="button" disabled={saving || draftCount === 0} onClick={() => void publishWeek()}>
                    {saving ? 'Publishing…' : 'Publish shifts'}
                  </Button>
                  <ActionFeedback
                    message={messageTarget === 'publish' ? message : null}
                    tone={message?.includes('Could') ? 'error' : 'success'}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {shiftContextMenu ? (
        <div
          className="roster-shift-context-menu"
          style={{ left: shiftContextMenu.x, top: shiftContextMenu.y }}
          role="menu"
          aria-label="Shift actions"
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => startEditShift(shiftContextMenu.shift)}>
            Edit shift
          </button>
          <button type="button" role="menuitem" disabled={saving} onClick={() => void duplicateShiftFromShift(shiftContextMenu.shift)}>
            Copy shift
          </button>
          <button type="button" role="menuitem" className="is-danger" disabled={saving} onClick={() => void deleteShift(shiftContextMenu.shift)}>
            Delete shift
          </button>
        </div>
      ) : null}
      {staffCardHover ? (() => {
        const { member, memberShifts, memberHours, rateLabel, costLabel, x, y } = staffCardHover;
        const cardWidth = 240;
        const left = Math.max(8, x - cardWidth - 12);
        const top = Math.max(8, y);
        return (
          <div
            className="roster-staff-card-popup"
            style={{ left, top }}
            role="tooltip"
          >
            <strong>{member.firstName} {member.lastName}</strong>
            <span className="roster-staff-card-role">{member.roleTitle || 'Team member'}</span>
            <div className="roster-staff-card-divider" />
            <div className="roster-staff-card-row"><span>Pay rate</span><span>{rateLabel}</span></div>
            {memberShifts.length > 0 ? (
              <>
                <div className="roster-staff-card-row"><span>Shifts this week</span><span>{memberShifts.length}</span></div>
                <div className="roster-staff-card-row"><span>Hours</span><span>{roundHours(memberHours)}</span></div>
                {costLabel ? <div className="roster-staff-card-row"><span>Est. cost</span><span>{costLabel.replace(' · ', '')}</span></div> : null}
              </>
            ) : (
              <div className="roster-staff-card-row subtle"><span>No shifts this week</span></div>
            )}
          </div>
        );
      })() : null}

      {/* Deputy stop-gap import modal — opens when "Import from Deputy" is
          clicked in the editorial roster header. */}
      {deputyImportOpen ? (
        <DeputyImportModal
          onClose={() => setDeputyImportOpen(false)}
          onSuccess={async () => {
            await refreshBoard(weekStart, weekEnd);
          }}
        />
      ) : null}
    </div>
  );
}

// Deputy roster CSV importer modal. Takes a CSV paste or file upload,
// runs a dry-run preview first, then the real import. Stays a stop-gap
// until Alma roster is fully tested.
function DeputyImportModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => Promise<void> | void }) {
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<{
    source: string;
    rowsRead: number;
    shiftsCreated: number;
    previousImportedShiftsDeleted: number;
    staffCreated: number;
    staffMatched: number;
    unallocatedShifts: number;
    dateRange: { start: string | null; end: string | null };
    skippedRows: Array<{ row: number; reason: string }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const [step, setStep] = useState<'paste' | 'preview' | 'done'>('paste');

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      setCsv(text);
      setFilename(file.name);
      setMessage(null);
    } catch {
      setMessageTone('error');
      setMessage('Could not read that file. Try copy-pasting the CSV content instead.');
    }
  }

  async function runPreview() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<typeof preview>('/api/integrations/deputy/import-roster', {
        method: 'POST',
        body: JSON.stringify({ csv, filename: filename || undefined, dryRun: true })
      });
      setPreview(result);
      setStep('preview');
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not preview the Deputy import.');
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<typeof preview>('/api/integrations/deputy/import-roster', {
        method: 'POST',
        body: JSON.stringify({ csv, filename: filename || undefined, dryRun: false })
      });
      setPreview(result);
      setStep('done');
      setMessageTone('success');
      setMessage(`Imported ${result?.shiftsCreated ?? 0} shifts.`);
      await onSuccess();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not run the Deputy import.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="staff-modal-backdrop" role="dialog" aria-labelledby="deputy-import-title" onClick={(event) => {
      // Click on backdrop closes, but clicks inside the dialog don't bubble.
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div className="staff-modal staff-modal--deputy">
        <header className="staff-modal-head">
          <span className="suite-feedback-eyebrow">Stop-gap integration</span>
          <h2 id="deputy-import-title" className="staff-modal-title">Import roster from Deputy</h2>
          <p className="staff-modal-sub">
            Deputy stays the source of truth until Alma roster is fully tested.
            Drop the latest CSV here to refresh shifts. Re-imports of the same file
            replace previous Deputy shifts in the same date range so they're idempotent.
          </p>
        </header>

        {step === 'paste' ? (
          <div className="staff-modal-body">
            <label className="field">
              <span className="field-label">Upload CSV</span>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void handleFile(file);
                }}
              />
            </label>
            <label className="field">
              <span className="field-label">Or paste CSV content</span>
              <textarea
                value={csv}
                onChange={(event) => setCsv(event.currentTarget.value)}
                placeholder="Paste the CSV exported from Deputy (headers included)…"
                rows={8}
                className="field-control"
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' }}
              />
            </label>
            {filename ? <p className="subtle">Loaded: {filename}</p> : null}
          </div>
        ) : null}

        {step === 'preview' && preview ? (
          <div className="staff-modal-body">
            <div className="stats-grid">
              <StatCard label="Rows read" value={preview.rowsRead} hint="Total CSV rows" />
              <StatCard label="Shifts to create" value={preview.shiftsCreated || (preview.rowsRead - preview.skippedRows.length)} hint="After validation" />
              <StatCard label="Staff matched" value={preview.staffMatched} hint="Existing profiles" />
              <StatCard label="Staff to create" value={preview.staffCreated} hint="New from this CSV" />
            </div>
            {preview.dateRange.start ? (
              <p className="subtle">
                Range: {new Date(preview.dateRange.start).toLocaleDateString()} → {preview.dateRange.end ? new Date(preview.dateRange.end).toLocaleDateString() : '—'}
              </p>
            ) : null}
            {preview.skippedRows.length ? (
              <div className="alma-preview-banner" role="status">
                <strong>{preview.skippedRows.length} rows will be skipped</strong>
                <span>{preview.skippedRows.slice(0, 3).map((r) => `Row ${r.row}: ${r.reason}`).join(' · ')}{preview.skippedRows.length > 3 ? ' …' : ''}</span>
              </div>
            ) : null}
            <p className="subtle">
              On confirm, previously-imported Deputy shifts in this date range with the same filename will be deleted and re-created so the data stays consistent with the latest Deputy export.
            </p>
          </div>
        ) : null}

        {step === 'done' && preview ? (
          <div className="staff-modal-body">
            <div className="alma-preview-banner" role="status">
              <strong>Done — Deputy roster imported.</strong>
              <span>
                {preview.shiftsCreated} shifts created · {preview.previousImportedShiftsDeleted} replaced ·
                {preview.staffCreated} new staff · {preview.staffMatched} matched · {preview.unallocatedShifts} unallocated
              </span>
            </div>
            <p className="subtle">
              The roster grid will refresh once you close this dialog.
            </p>
          </div>
        ) : null}

        {message ? <ActionFeedback message={message} tone={messageTone} /> : null}

        <footer className="staff-modal-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {step === 'done' ? 'Close' : 'Cancel'}
          </Button>
          {step === 'paste' ? (
            <Button type="button" onClick={() => void runPreview()} disabled={busy || !csv.trim()}>
              {busy ? 'Checking…' : 'Preview import'}
            </Button>
          ) : null}
          {step === 'preview' ? (
            <Button type="button" onClick={() => void runImport()} disabled={busy}>
              {busy ? 'Importing…' : 'Confirm import'}
            </Button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function MobileRosterView({
  dailySummaries,
  selectedDate,
  selectedSummary,
  shifts,
  venueGroups,
  venueLabel,
  onSelectDay,
  onAddShift,
  onOpenShift
}: {
  dailySummaries: Array<{ day: Date; shifts: number; hours: number; people: number }>;
  selectedDate: Date;
  selectedSummary?: { day: Date; shifts: number; hours: number; people: number };
  shifts: RosterShift[];
  venueGroups: MobileRosterVenueGroup[];
  venueLabel: string;
  onSelectDay: (day: string) => void;
  onAddShift: () => void;
  onOpenShift: (shift: RosterShift) => void;
}) {
  const peopleCount = selectedSummary?.people ?? new Set(shifts.map((shift) => shift.staffProfileId)).size;
  const hours = selectedSummary?.hours ?? shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);

  return (
    <section className="mobile-roster-surface mobile-roster" aria-label="Mobile roster">
      <div className="mobile-roster-topbar">
        <div>
          <p className="eyebrow">Roster</p>
          <h2>{selectedDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</h2>
          <span>
            {venueLabel} · {selectedSummary?.shifts ?? shifts.length} shifts
          </span>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={onAddShift}>
          Add shift
        </Button>
      </div>

      <div className="mobile-roster-day-cards" aria-label="Roster day summary">
        {dailySummaries.map((summary) => {
          const selected = sameDay(summary.day, selectedDate);
          return (
            <button
              key={summary.day.toISOString()}
              type="button"
              className={`mobile-roster-day-card ${selected ? 'is-selected' : ''} ${sameDay(summary.day, new Date()) ? 'is-today' : ''}`}
              aria-pressed={selected}
              aria-current={selected ? 'date' : undefined}
              onClick={() => onSelectDay(toDateInput(summary.day))}
            >
              <span>{summary.day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <strong>{summary.day.toLocaleDateString(undefined, { day: 'numeric' })}</strong>
              <small>{summary.shifts} shifts</small>
              <small>{summary.people} people · {roundHours(summary.hours)}</small>
            </button>
          );
        })}
      </div>

      <div className="mobile-roster-day-detail">
        <div className="mobile-roster-day-heading">
          <div>
            <strong>{selectedDate.toLocaleDateString(undefined, { weekday: 'long' })}</strong>
            <span>{peopleCount} people · {roundHours(hours)}</span>
          </div>
          <Badge tone={shifts.length ? 'info' : 'muted'}>{shifts.length} shifts</Badge>
        </div>

        {shifts.length === 0 ? (
          <EmptyState
            title="No shifts scheduled"
            description="This day has no rostered shifts for the current filters."
            action={<Button type="button" size="sm" onClick={onAddShift}>Add shift</Button>}
          />
        ) : venueGroups.length === 0 ? (
          <EmptyState
            title="No area rows match"
            description="This day has shifts, but no venue or area rows match the current search and view filters."
          />
        ) : (
          <div className="mobile-roster-sections">
            {venueGroups.map((venueGroup) => (
              <section key={venueGroup.venue} className="mobile-roster-venue-section">
                <div className="mobile-roster-venue-header">
                  <span className="roster-avatar" aria-hidden="true">{venueGroup.initials}</span>
                  <div>
                    <strong>{venueGroup.venue}</strong>
                    <small>
                      {venueGroup.areas.length} area{venueGroup.areas.length === 1 ? '' : 's'} · {venueGroup.shifts.length} shift{venueGroup.shifts.length === 1 ? '' : 's'} · {roundHours(venueGroup.shifts.reduce((sum, shift) => sum + shiftHours(shift), 0))}
                    </small>
                  </div>
                </div>

                {venueGroup.areas.map((areaGroup) => {
                  const areaHours = areaGroup.shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
                  return (
                    <section key={`${venueGroup.venue}:${areaGroup.area}`} className="mobile-roster-area-section">
                      <div className="mobile-roster-section-header" style={areaStyle(areaGroup.area)}>
                        <strong>{areaGroup.area}</strong>
                        <small>{roundHours(areaHours)}</small>
                        <span>{areaGroup.shifts.length}</span>
                      </div>
                      <div className="mobile-shift-list">
                        {areaGroup.shifts.map((shift) => {
                          const staffName = rosterShiftStaffName(shift);
                          const shiftVenueName = shift.venue || shift.staffProfile?.venue || venueGroup.venue || 'No venue';
                          const shiftArea = shift.area || areaGroup.area || shift.roleTitle || 'Shift';
                          const statusGroup = mobileRosterStatusGroup(shift);
                          return (
                            <button
                              key={shift.id}
                              type="button"
                              className="mobile-shift-row"
                              style={areaStyle(shiftArea)}
                              onClick={() => onOpenShift(shift)}
                            >
                              <span className="mobile-shift-avatar" aria-hidden="true">
                                {shift.staffProfile && !isOpenShift(shift) ? initials(shift.staffProfile) : shiftArea.slice(0, 2).toUpperCase()}
                              </span>
                              <span className={`mobile-shift-status-dot is-${mobileRosterGroupClass(statusGroup)}`} aria-hidden="true" />
                              <span className="mobile-shift-main">
                                <strong>{staffName}</strong>
                                <span>{timeOf(shift.startsAt)} - {timeOf(shift.endsAt)}</span>
                                <small>{shiftArea} · {shiftVenueName}</small>
                              </span>
                              <span className="mobile-shift-meta">
                                <small>{mobileRosterStatusText(shift, statusGroup)}</small>
                                <span aria-hidden="true">›</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// Any "hourly rate" above $200/hr is bad data — almost always an annual salary
// that's landed in an hourly field. The roster forecast clamps to this so one
// bad record can't blow the whole board's wage total up.
const ROSTER_SANE_MAX_RATE_CENTS = 20000;

// The effective hourly cost (cents) the roster forecast should use for a
// staffer — mirrors the reports' costing: cash gets its flat rate, salaried /
// full-timers get their salary spread over a 45h week, everyone else the
// hourly/award rate. Returns null when no usable rate (caller falls back to the
// roster average). Deliberately excludes super so the forecast matches the
// roster's prior basis; reports add on-costs separately.
function rosterHourlyRateCents(member: StaffProfile): number | null {
  const profile = member.payProfile;
  const sane = (cents: number | null | undefined): number | null =>
    cents && cents > 0 && cents <= ROSTER_SANE_MAX_RATE_CENTS ? cents : null;

  // Cash — flat hourly rate, paid in cash.
  if (profile?.payMode === 'CASH') return sane(profile.cashHourlyRateCents);

  // Salaried / full-time — convert the salary to an hourly rate over a 45h week.
  const salaried =
    profile?.payMode === 'MANUAL_FULL_TIME' ||
    /full.?time|salar|permanent/i.test(profile?.employmentType ?? member.employmentType ?? '');
  if (salaried && profile?.manualFullTimePayAmountCents) {
    const amount = profile.manualFullTimePayAmountCents;
    const freq = (profile.manualFullTimePayFrequency ?? '').toUpperCase();
    if (freq === 'HOURLY_FULL_TIME') return sane(amount);
    const annual =
      freq === 'WEEKLY' ? amount * 52
      : freq === 'FORTNIGHTLY' ? amount * 26
      : freq === 'MONTHLY' ? amount * 12
      : amount; // ANNUAL_SALARY / default
    return sane(Math.round(annual / 52 / 45));
  }

  // Hourly — training rate, then base, then the award ordinary rate.
  return sane(member.trainingPayRateCents)
    ?? sane(member.payRateCents)
    ?? sane(profile?.ordinaryHourlyRateCents);
}

function mobileRosterStatusGroup(shift: RosterShift): MobileRosterGroupKey {
  if (isOpenShift(shift)) return 'unassigned';
  if (shift.status === 'COMPLETED' || shift.status === 'CANCELLED') return 'completed';
  const startsAt = new Date(shift.startsAt).getTime();
  const endsAt = new Date(shift.endsAt).getTime();
  const now = Date.now();
  if (!Number.isNaN(startsAt) && !Number.isNaN(endsAt)) {
    if (startsAt <= now && endsAt >= now && shift.status === 'PUBLISHED') return 'onShift';
    if (endsAt < now) return 'late';
  }
  return 'scheduled';
}

function mobileRosterGroupClass(group: MobileRosterGroupKey) {
  return group.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function mobileRosterStatusText(shift: RosterShift, group: MobileRosterGroupKey) {
  if (group === 'onShift') return 'On shift';
  if (group === 'late') return 'Needs review';
  if (group === 'unassigned') return 'Unassigned';
  if (shift.status === 'DRAFT') return 'Draft';
  if (shift.status === 'CANCELLED') return 'Cancelled';
  if (shift.status === 'COMPLETED') return 'Completed';
  return 'Scheduled';
}

function rosterShiftStaffName(shift: RosterShift) {
  if (isOpenShift(shift)) return 'Unassigned shift';
  return `${shift.staffProfile?.firstName ?? ''} ${shift.staffProfile?.lastName ?? ''}`.trim() || 'Unassigned shift';
}

function countRosterOverlaps(shifts: RosterShift[]) {
  let conflicts = 0;
  const byStaff = shifts
    // An open shift is on nobody's roster, so it cannot clash with anything.
    .filter((shift) => shift.status !== 'CANCELLED' && shift.staffProfileId !== null)
    .reduce((groups, shift) => {
      const group = groups.get(shift.staffProfileId!) ?? [];
      group.push(shift);
      groups.set(shift.staffProfileId!, group);
      return groups;
    }, new Map<string, RosterShift[]>());

  for (const staffShifts of byStaff.values()) {
    const sorted = staffShifts
      .map((shift) => ({
        startsAt: new Date(shift.startsAt),
        endsAt: new Date(shift.endsAt)
      }))
      .filter((shift) => !Number.isNaN(shift.startsAt.getTime()) && !Number.isNaN(shift.endsAt.getTime()))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    for (let index = 0; index < sorted.length - 1; index += 1) {
      if (rangesOverlap(sorted[index].startsAt, sorted[index].endsAt, sorted[index + 1].startsAt, sorted[index + 1].endsAt)) {
        conflicts += 1;
      }
    }
  }

  return conflicts;
}

function loadRosterForecastDraft(): RosterForecastDraft {
  const fallback: RosterForecastDraft = {
    forecastSales: '',
    targetWagePercent: '32',
    dailyForecastSales: {}
  };

  try {
    const raw = window.localStorage.getItem(ROSTER_FORECAST_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<RosterForecastDraft>;
    return {
      forecastSales: typeof parsed.forecastSales === 'string' ? parsed.forecastSales : fallback.forecastSales,
      targetWagePercent: typeof parsed.targetWagePercent === 'string' ? parsed.targetWagePercent : fallback.targetWagePercent,
      dailyForecastSales:
        parsed.dailyForecastSales && typeof parsed.dailyForecastSales === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.dailyForecastSales).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            )
          : fallback.dailyForecastSales
    };
  } catch {
    return fallback;
  }
}

function isDeputyImportedShift(shift: Pick<RosterShift, 'notes'>) {
  return (shift.notes ?? '').includes('Deputy import:');
}

/**
 * A shift nobody is on. The real answer is a null staffProfileId; the
 * placeholder-profile check stays for rosters imported from Deputy before the
 * open-shift migration converted them.
 */
function isOpenShift(shift: { staffProfileId?: string | null; staffProfile?: { firstName?: string | null; notes?: string | null } | null }) {
  if (shift.staffProfileId === null) return true;
  return isUnallocatedProfile(shift.staffProfile);
}

function parsePercent(value: string | undefined, fallback = 32) {
  const numeric = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}
