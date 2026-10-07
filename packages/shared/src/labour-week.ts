// The Labour vs takings payload (GET /api/staff/labour-week), shared by the
// API engine (apps/api/src/lib/labour-week.ts) and the Staff app's Labour
// page so the two cannot drift. The engine's rules are documented in
// docs/metric-definitions.md ("Labour vs takings").

export type RosterDepartment = 'KITCHEN' | 'FOH' | 'MANAGEMENT' | 'UNCLASSIFIED';

export type LabourVenueStatus = 'configured' | 'invalid' | 'unassigned';

export const DEPARTMENTS: RosterDepartment[] = ['KITCHEN', 'FOH', 'MANAGEMENT', 'UNCLASSIFIED'];

export type DepartmentFigures = {
  spanHours: number;
  paidHours: number;
  /** Paid hours that have a rate and are in costCents. */
  costedHours: number;
  /** Paid hours with no rate; not in costCents. */
  uncostedHours: number;
  costCents: number;
  /** costCents / salesCents × 100, one decimal; null when there are no sales. */
  labourPct: number | null;
};

export type LabourFigures = DepartmentFigures & {
  /** Hours on shifts nobody is on yet (open shifts): not in any other hours figure. */
  openHours: number;
  byDepartment: Record<RosterDepartment, DepartmentFigures>;
};

export type LabourWeekDayCell = LabourFigures & {
  date: string;
  venue: string;
  /** null = no takings recorded for that venue-day. */
  salesCents: number | null;
  publicHoliday: string | null;
};

export type LabourWeekVenue = LabourFigures & {
  venue: string;
  /** configured = a real venue; invalid = a label that is not one; unassigned = no label anywhere. */
  venueStatus: LabourVenueStatus;
  salesCents: number;
  /** Venue-days with a takings figure. */
  salesDays: number;
  days: LabourWeekDayCell[];
  target: { wagePct: number; configured: boolean; source: string; variancePts: number | null } | null;
};

export type LabourWeekPerson = {
  staffProfileId: string;
  name: string;
  employmentType: string;
  salaried: boolean;
  contractedWeeklyHours: number | null;
  spanHours: number;
  paidHours: number;
  headroomHours: number;
  overtimeHours: number;
  overAgreedHours: number;
  overtimeCostCents: number | null;
  /** The week's cost for this person; null when their rate is missing. */
  estWeekCostCents: number | null;
  rateKnown: boolean;
  rateSource: string;
  /** Venues the person was rostered at this week, with paid hours. */
  venues: Array<{ venue: string; paidHours: number }>;
};

export type LabourWeekShiftRow = {
  shiftId: string;
  staffProfileId: string | null;
  name: string;
  date: string;
  venue: string;
  venueSource: 'explicit' | 'profile' | 'invalid' | 'unassigned';
  /** The label as written on the shift, for the audit. */
  venueLabel: string | null;
  department: RosterDepartment;
  departmentBasis: string;
  area: string | null;
  roleTitle: string | null;
  startsAt: string;
  endsAt: string;
  spanHours: number;
  unpaidBreakHours: number;
  paidHours: number;
  status: string;
  /** Present only when the reader may see rates. */
  rateCents?: number | null;
  rateSource?: string;
  /** Present only when the reader may see rates; null when the rate is missing. */
  costCents?: number | null;
  /** How the cost was arrived at ("12.5h × $38.40 incl. super", "share of weekly salary"). */
  costBasis?: string;
};

export type LabourWeekSaleRow = {
  id: string;
  date: string;
  venue: string;
  venueLabel: string;
  source: string;
  salesCents: number;
  /** Whether this row is the one the report used for that venue-day (the largest across feeds). */
  used: boolean;
  notes: string | null;
};

export type LabourWeekPayload = {
  weekStart: string;
  weekEnd: string;
  timeZone: string;
  dayKeys: string[];
  venueNames: string[];
  venues: LabourWeekVenue[];
  group: LabourFigures & {
    salesCents: number;
    salesDays: number;
    target: LabourWeekVenue['target'];
    byDay: Array<LabourFigures & { date: string; salesCents: number | null; publicHoliday: string | null }>;
  };
  people: LabourWeekPerson[];
  incomplete: {
    /** True when any rostered hour could not be costed, or a venue label could not be placed. */
    flag: boolean;
    uncostedHours: number;
    uncostedPeople: Array<{ staffProfileId: string; name: string; paidHours: number }>;
    unplacedVenueLabels: string[];
    unclassifiedHours: number;
    /** Salaried staff whose weekly cost is NOT in this roster-based figure because they have no shift this week. */
    unrosteredSalaried: Array<{ staffProfileId: string; name: string; weeklyFixedCostCents: number | null }>;
  };
  methodology: {
    sales: string;
    hours: string;
    cost: string;
    notCosted: string[];
    superRatePct: number;
  };
  reconciliation: {
    shifts: LabourWeekShiftRow[];
    sales: LabourWeekSaleRow[];
    ratesVisible: boolean;
  };
  /** Kept for callers that read the old shape. */
  totals: { salesCents: number; estCostCents: number; overtimeCostCents: number };
};

