import { DragEvent, FormEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuthUser,
  GuestTimelinePayload,
  GoogleReserveIntegrationSetting,
  ReserveAvailabilityRule,
  ReserveBlackout,
  ReserveDashboardPayload,
  ReserveDiarySummary,
  ReserveGuest,
  ReservePublicAvailabilityResponse,
  ReservePublicBookingConfirmation,
  ReservePublicManageView,
  ReservePublicWidgetConfig,
  ReserveReservation,
  ReserveReservationStatus,
  ReserveNoShowChargeResult,
  ReserveServicePeriod,
  ReserveTable,
  ReserveTableCall,
  ReserveTableCallAction,
  ReserveTableCallType,
  ReserveSquareTableOrder,
  ReserveSquareOrdersPayload,
  ReserveDrinkPackage,
  ReserveArea,
  ReserveWaitlistEntry,
  ReserveWaitlistStatus
} from '@alma/shared';
import {
  ActionFeedback,
  AlmaHomeBubble,
  AlmaPill,
  AppShell,
  Badge,
  BigStat,
  BookIcon,
  Button,
  Card,
  DocumentIcon,
  EmptyState,
  GearIcon,
  Input,
  ProductLogo,
  SearchIcon,
  Select,
  Spinner,
  StatCard,
  SUITE_APPS,
  SuiteAppSwitcher,
  SuiteClock,
  SuiteFeedbackWidget,
  SuiteInboxWidget,
  Textarea,
  ThemeToggle,
  TopBar,
  useDismissibleLayer
} from '@alma/ui';
import { SuiteSignOutButton } from '@alma/ui';
import { withSuiteAppLinks } from './config/suiteLinks';
import { api, clearApiAuthToken, consumeSuiteHandoffToken, installSuiteHandoff, setApiAuthToken } from './lib/api';
import { DrinksPaymentPanel } from './DrinksPaymentPanel';

const suiteApps = withSuiteAppLinks(SUITE_APPS);
const ALL_VENUES = 'All venues';
const KNOWN_VENUES = ['Alma Avalon', 'St Alma'];
const SERVICE_PERIODS: ReserveServicePeriod[] = ['BREAKFAST', 'LUNCH', 'DINNER', 'EVENT'];
const RESERVATION_STATUSES: ReserveReservationStatus[] = ['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
const GOOGLE_STATUSES = ['SETUP_REQUIRED', 'PENDING', 'ACTIVE', 'ERROR'] as const;
const DEFAULT_RESERVE_PUBLIC_VENUE = {
  location: 'Alma Group',
  image: '/images/alma-avalon-margaritas.jpg',
  summary: 'Alma Group dining with online booking availability.',
  description: 'Choose your venue, check available times, and send a booking request through to the restaurant team.',
  website: 'https://www.almagroup.com.au/'
};
const RESERVE_PUBLIC_VENUES: Record<string, { location: string; image: string; summary: string; description: string; website: string }> = {
  'Alma Avalon': {
    location: 'Avalon Beach',
    image: '/images/alma-avalon-margaritas.jpg',
    summary: 'Beachside Mexican dining, margaritas, long lunches, and relaxed evening bookings.',
    description: 'A relaxed coastal dining room for tacos, shared plates, margaritas, birthdays, and long lunches near the beach.',
    website: 'https://www.almagroup.com.au/alma-avalon'
  },
  'St Alma': {
    location: 'Freshwater',
    image: '/images/st-alma-food.JPG',
    summary: 'Coastal dining in Freshwater with bright share plates, cocktails, and group tables.',
    description: 'A bright Freshwater venue for coastal dining, cocktails, group tables, and neighbourhood catch-ups.',
    website: 'https://www.almagroup.com.au/st-alma'
  }
};
const servicePeriodLabels: Record<ReserveServicePeriod, string> = {
  BREAKFAST: 'Breakfast',
  LUNCH: 'Lunch',
  DINNER: 'Dinner',
  EVENT: 'Event'
};
const MANAGER_NAV_ITEMS = [
  { href: '#dashboard', label: 'Dashboard', description: 'Bookings and covers', icon: <DocumentIcon /> },
  { href: '#service', label: 'Service', description: 'Live floor — seat, courses, bill', icon: <DocumentIcon /> },
  { href: '#guests', label: 'Guests', description: 'CRM and visit history', icon: <SearchIcon /> },
  { href: '#waitlist', label: 'Waitlist', description: 'Walk-in queue for peak periods', icon: <SearchIcon /> },
  { href: '#settings', label: 'Settings', description: 'Rules, packages, tables, floor plan', icon: <GearIcon /> },
  { href: '#widget-preview', label: 'Widget', description: 'Safe public booking preview', icon: <DocumentIcon /> },
  { href: '#google-reserve', label: 'Google Reserve', description: 'Setup-required integration', icon: <GearIcon /> }
];

// Config surfaces (booking rules, drink packages, tables, floor plan) live under
// one full-width Settings tab, switched by hash sub-nav. The old per-area tabs
// rendered Drinks/Tables inside the narrow 340-420px aside, so they were unreadable.
const SETTINGS_HASHES = ['#settings', '#availability', '#drinks', '#areas', '#tables', '#floor-plan'];
const SETTINGS_TABS = [
  { hash: '#availability', key: 'rules', label: 'Booking rules' },
  { hash: '#drinks', key: 'drinks', label: 'Drink packages' },
  { hash: '#areas', key: 'areas', label: 'Areas' },
  { hash: '#tables', key: 'tables', label: 'Tables' },
  { hash: '#floor-plan', key: 'floor-plan', label: 'Floor plan' }
] as const;

function resolveNavItem(activeHash: string) {
  return (
    MANAGER_NAV_ITEMS.find((item) => item.href === activeHash) ??
    (SETTINGS_HASHES.includes(activeHash) ? MANAGER_NAV_ITEMS.find((item) => item.href === '#settings') : undefined) ??
    MANAGER_NAV_ITEMS[0]!
  );
}

// Waitlist is server-backed (GET/POST/PATCH /reserve/waitlist). The UI maps its
// operational actions onto the DB status enum: Seated -> BOOKED, Notify ->
// NOTIFIED, Left -> EXPIRED, Cancel -> CANCELLED. A walk-in's "estimated wait"
// is encoded as the windowStartsAt(now) -> windowEndsAt(now + est) span.
const WAITLIST_WAITING: ReserveWaitlistStatus[] = ['WAITING', 'NOTIFIED'];

type FeedbackTone = 'success' | 'error';

type FeedbackState = {
  target: string | null;
  message: string | null;
  tone: FeedbackTone;
};

type ReservationForm = {
  venue: string;
  serviceDate: string;
  servicePeriod: ReserveServicePeriod;
  time: string;
  durationMinutes: string;
  covers: string;
  area: string;
  tableId: string;
  availabilityRuleId: string;
  status: ReserveReservationStatus;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  marketingOptIn: boolean;
  occasion: string;
  specialRequests: string;
  internalNotes: string;
};

type TableForm = {
  venue: string;
  area: string;
  label: string;
  minCovers: string;
  maxCovers: string;
  sortOrder: string;
};

type RuleForm = {
  venue: string;
  name: string;
  servicePeriod: ReserveServicePeriod;
  startTime: string;
  endTime: string;
  intervalMinutes: string;
  defaultDurationMinutes: string;
  minPartySize: string;
  maxPartySize: string;
  capacity: string;
  daysOfWeek: number[];
  onlineEnabled: boolean;
  googleReserveEnabled: boolean;
};

type BlackoutForm = {
  venue: string;
  name: string;
  reason: string;
  startAt: string;
  endAt: string;
};

type WidgetSearchForm = {
  venue: string;
  date: string;
  partySize: string;
  servicePeriod: ReserveServicePeriod | '';
};

type WidgetBookingForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  birthday: string;
  anniversary: string;
  occasion: string;
  dietaryNotes: string;
  seatingPreference: string;
  highChair: boolean;
  accessibility: boolean;
  outdoorSeating: boolean;
  barSeating: boolean;
  specialRequests: string;
  marketingOptIn: boolean;
};

const BOOKING_PREFERENCE_FIELDS: Array<{ key: keyof Pick<WidgetBookingForm, 'highChair' | 'accessibility' | 'outdoorSeating' | 'barSeating'>; label: string }> = [
  { key: 'highChair', label: 'High chair' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'outdoorSeating', label: 'Outdoor seating' },
  { key: 'barSeating', label: 'Bar seating' }
];

type MarketingGuestDetail = {
  guest: ReserveGuest;
  reservations: ReserveReservation[];
  timeline?: GuestTimelinePayload;
};

function todayInput() {
  return toDateInput(new Date());
}

function toDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function toDateTimeInput(value: Date) {
  return `${toDateInput(value)}T${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function dateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`);
}

function statusTone(status: ReserveReservationStatus) {
  switch (status) {
    case 'CONFIRMED':
    case 'SEATED':
    case 'COMPLETED':
      return 'positive';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'danger';
    case 'PENDING':
    default:
      return 'warning';
  }
}

function fullName(guest: ReserveGuest | null | undefined) {
  if (!guest) return 'Walk-in guest';
  return `${guest.firstName} ${guest.lastName}`.trim();
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
}

function longDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Editorial booking row — used in the Tonight service feed
type BookingRowProps = {
  reservation: ReserveReservation;
  feedback: FeedbackState;
  onStatus: (status: ReserveReservationStatus) => void;
  onRedeemDrinks?: () => void;
  onChargeNoShow?: () => void;
};

function statusPillKind(status: ReserveReservationStatus): { label: string; kind: 'success' | 'warn' | 'danger' | 'info' | 'neutral' } {
  switch (status) {
    case 'SEATED':
      return { label: 'Seated', kind: 'success' };
    case 'COMPLETED':
      return { label: 'Departed', kind: 'neutral' };
    case 'CONFIRMED':
      return { label: 'Confirmed', kind: 'info' };
    case 'PENDING':
      return { label: 'Pending', kind: 'warn' };
    case 'CANCELLED':
      return { label: 'Cancelled', kind: 'neutral' };
    case 'NO_SHOW':
      return { label: 'No-show', kind: 'danger' };
  }
}

function dietaryTone(text: string): 'allergy' | 'diet' | 'occasion' | 'neutral' {
  const lower = text.toLowerCase();
  if (lower.match(/allerg|gluten|nut|shellfish|dairy|coeliac|celiac/)) return 'allergy';
  if (lower.match(/vegan|vegetarian|kosher|halal|pescatarian/)) return 'diet';
  return 'neutral';
}

function BookingRow({ reservation, feedback, onStatus, onRedeemDrinks, onChargeNoShow }: BookingRowProps) {
  const status = statusPillKind(reservation.status);
  const guestName = reservation.guestName || fullName(reservation.guest);
  const note = reservation.specialRequests || reservation.notes;
  const isVip = reservation.guest?.tags?.some((t) => t.toLowerCase().includes('vip'))
    || (reservation.specialRequests || '').toLowerCase().includes('vip');
  // Compact action — surface the most likely next state
  const nextAction = (() => {
    if (reservation.status === 'CONFIRMED' || reservation.status === 'PENDING') {
      return { label: 'Seat', target: 'SEATED' as ReserveReservationStatus };
    }
    if (reservation.status === 'SEATED') {
      return { label: 'Complete', target: 'COMPLETED' as ReserveReservationStatus };
    }
    return null;
  })();

  return (
    <div className={`alma-booking-row ${isVip ? 'is-vip' : ''}`}>
      <div className="alma-booking-time">
        <div className="alma-booking-time-value">{timeLabel(reservation.startsAt)}</div>
        {reservation.table?.label ? (
          <div className="alma-booking-table">{reservation.table.label}</div>
        ) : null}
      </div>
      <div className="alma-booking-main">
        <div className="alma-booking-main-head">
          {isVip ? <span className="alma-booking-vip">★ VIP</span> : null}
          <span className="alma-booking-name">{guestName || 'Guest'}</span>
          <span className="alma-booking-party">· party of {reservation.covers}</span>
        </div>
        <div className="alma-booking-meta">
          <AlmaPill kind={status.kind} dot>{status.label}</AlmaPill>
          {reservation.occasion ? (
            <span className="alma-booking-chip alma-booking-chip--occasion">{reservation.occasion}</span>
          ) : null}
          {note && note.length > 0 ? (
            <span className={`alma-booking-chip alma-booking-chip--${dietaryTone(note)}`}>
              {note.length > 36 ? `${note.slice(0, 33)}…` : note}
            </span>
          ) : null}
          {reservation.drinksPaidAt ? (
            <span className={`alma-booking-chip alma-booking-chip--drinks${reservation.drinksRedeemedAt ? ' is-served' : ''}`}>
              🍸 Drinks ${((reservation.drinksTotalCents ?? 0) / 100).toFixed(2)}{reservation.drinksRedeemedAt ? ' · served' : ' · prepaid'}
            </span>
          ) : null}
          {reservation.noShowFeeChargedAt ? (
            <span className="alma-booking-chip alma-booking-chip--drinks is-served">
              💳 No-show fee ${((reservation.noShowFeeAmountCents ?? 0) / 100).toFixed(2)} charged
            </span>
          ) : reservation.hasCardOnFile && reservation.status !== 'CANCELLED' ? (
            <span className="alma-booking-chip alma-booking-chip--occasion">
              💳 Card on file{reservation.cardBrand ? ` · ${reservation.cardBrand}` : ''}{reservation.cardLast4 ? ` ••${reservation.cardLast4}` : ''}
            </span>
          ) : null}
          {reservation.noShowFeeError && !reservation.noShowFeeChargedAt ? (
            <span className="alma-booking-chip alma-booking-chip--allergy">
              ⚠ No-show charge failed
            </span>
          ) : null}
        </div>
        {reservation.internalNotes ? (
          <div className="alma-booking-note">&ldquo;{reservation.internalNotes}&rdquo;</div>
        ) : null}
        {feedback.target === `reservation:${reservation.id}` && feedback.message ? (
          <div className="alma-booking-feedback">
            <ActionFeedback message={feedback.message} tone={feedback.tone} />
          </div>
        ) : null}
      </div>
      <div className="alma-booking-actions">
        {nextAction ? (
          <button
            type="button"
            className="alma-booking-primary"
            onClick={() => onStatus(nextAction.target)}
          >
            {nextAction.label}
          </button>
        ) : null}
        {(reservation.status === 'CONFIRMED' || reservation.status === 'PENDING') ? (
          <button
            type="button"
            className="alma-booking-ghost"
            onClick={() => onStatus('NO_SHOW')}
          >
            No-show
          </button>
        ) : null}
        {(reservation.status === 'CONFIRMED' || reservation.status === 'PENDING') ? (
          <button
            type="button"
            className="alma-booking-ghost"
            onClick={() => onStatus('CANCELLED')}
          >
            Cancel
          </button>
        ) : null}
        {reservation.drinksPaidAt && onRedeemDrinks ? (
          <button type="button" className="alma-booking-ghost" onClick={onRedeemDrinks}>
            {reservation.drinksRedeemedAt ? 'Undo drinks' : 'Drinks served'}
          </button>
        ) : null}
        {reservation.status === 'NO_SHOW' && !reservation.noShowFeeChargedAt && reservation.hasCardOnFile && onChargeNoShow ? (
          <button type="button" className="alma-booking-ghost" onClick={onChargeNoShow}>
            {reservation.noShowFeeError ? 'Retry no-show fee' : 'Charge no-show fee'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function dateInputFromIso(value: string) {
  return toDateInput(new Date(value));
}

function nextDateOptions(date: string) {
  const start = date ? new Date(`${date}T00:00:00`) : new Date();
  return [1, 2, 3, 4].map((offset) => toDateInput(addDays(start, offset)));
}

function slotDateKey(value: string) {
  return dateInputFromIso(value);
}

function serviceCopy(period: ReserveServicePeriod | null | undefined) {
  return period ? servicePeriodLabels[period] : 'Dining room';
}

function isAdmin(user: AuthUser) {
  return Boolean(user.isAdmin || user.role === 'ADMIN');
}

function effectiveVenueOptions(user: AuthUser) {
  return isAdmin(user)
    ? [{ label: ALL_VENUES, value: ALL_VENUES }, ...KNOWN_VENUES.map((venue) => ({ label: venue, value: venue }))]
    : [{ label: user.venue || KNOWN_VENUES[0]!, value: user.venue || KNOWN_VENUES[0]! }];
}

function firstManagerVenue(user: AuthUser, preferred?: string | null) {
  if (preferred && preferred !== ALL_VENUES) return preferred;
  if (user.venue) return user.venue;
  return KNOWN_VENUES[0]!;
}

function defaultFeedback(): FeedbackState {
  return { target: null, message: null, tone: 'success' };
}

function defaultReservationForm(venue: string): ReservationForm {
  return {
    venue,
    serviceDate: todayInput(),
    servicePeriod: 'DINNER',
    time: '18:30',
    durationMinutes: '120',
    covers: '2',
    area: '',
    tableId: '',
    availabilityRuleId: '',
    status: 'CONFIRMED',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    marketingOptIn: false,
    occasion: '',
    specialRequests: '',
    internalNotes: ''
  };
}

function defaultTableForm(venue: string): TableForm {
  return {
    venue,
    area: 'Dining room',
    label: '',
    minCovers: '1',
    maxCovers: '4',
    sortOrder: '0'
  };
}

function defaultRuleForm(venue: string): RuleForm {
  return {
    venue,
    name: 'Dinner online bookings',
    servicePeriod: 'DINNER',
    startTime: '17:30',
    endTime: '21:30',
    intervalMinutes: '30',
    defaultDurationMinutes: '120',
    minPartySize: '1',
    maxPartySize: '6',
    capacity: '30',
    daysOfWeek: [3, 4, 5, 6],
    onlineEnabled: true,
    googleReserveEnabled: false
  };
}

function defaultBlackoutForm(venue: string): BlackoutForm {
  const start = new Date();
  start.setHours(17, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return {
    venue,
    name: 'Private event hold',
    reason: '',
    startAt: toDateTimeInput(start),
    endAt: toDateTimeInput(end)
  };
}

function defaultWidgetSearch(venue: string): WidgetSearchForm {
  return {
    venue,
    date: todayInput(),
    partySize: '2',
    servicePeriod: 'DINNER'
  };
}

function defaultWidgetBooking(): WidgetBookingForm {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    birthday: '',
    anniversary: '',
    occasion: '',
    dietaryNotes: '',
    seatingPreference: '',
    highChair: false,
    accessibility: false,
    outdoorSeating: false,
    barSeating: false,
    specialRequests: '',
    marketingOptIn: false
  };
}

function useReserveAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const handoffUser = await consumeSuiteHandoffToken();
      if (handoffUser) {
        setUser(handoffUser);
        return;
      }
      const data = await api<{ user: AuthUser | null }>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => installSuiteHandoff(), []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await api<{ user: AuthUser; token?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setApiAuthToken(session.token);
    setUser(session.user);
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    clearApiAuthToken();
    setUser(null);
  }, []);

  return { user, loading, login, logout };
}

function LoginScreen({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await onLogin(email.trim(), password);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-shell">
        <ProductLogo appId="reserve" size="lg" />
        <Card title="Sign in" subtitle="Use your ALMA manager account to open Reserve">
          <form className="login-form" onSubmit={handleSubmit}>
            <Input label="Email" type="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
            <Input label="Password" type="password" required value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
            {message ? <p className="error-text">{message}</p> : null}
            <Button type="submit" disabled={submitting}>{submitting ? 'Signing in...' : 'Sign in'}</Button>
          </form>
        </Card>
        <SuiteAppSwitcher currentApp="reserve" apps={suiteApps} />
      </div>
    </main>
  );
}

function SidebarNav() {
  const navRef = useRef<HTMLDivElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeHash, setActiveHash] = useState('#dashboard');
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  useDismissibleLayer(navRef, mobileMenuOpen, closeMobileMenu, 'reserve-mobile-nav');

  useEffect(() => {
    const syncHash = () => setActiveHash(window.location.hash || '#dashboard');
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  const active = resolveNavItem(activeHash);

  return (
    <div ref={navRef} className="mobile-nav-layer">
      <button
        className="mobile-nav-toggle"
        type="button"
        aria-expanded={mobileMenuOpen}
        aria-controls="reserve-mobile-nav"
        onClick={() => setMobileMenuOpen((open) => !open)}
      >
        <span className="mobile-nav-toggle-current">
          <span className="sidebar-nav-icon">{active.icon}</span>
          <span>{active.label}</span>
        </span>
        <span className="mobile-nav-toggle-caret" aria-hidden="true">⌄</span>
      </button>
      <ul id="reserve-mobile-nav" className={`sidebar-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <li className="sidebar-nav-section">Reserve</li>
        {MANAGER_NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              className={active.href === item.href ? 'active' : ''}
              onClick={() => {
                setActiveHash(item.href);
                setMobileMenuOpen(false);
              }}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FunctionEnquiryPanel({ venue }: { venue: string }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    contactName: '',
    email: '',
    phone: '',
    eventType: '',
    eventDate: '',
    partySize: '20',
    notes: ''
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api('/api/reserve/public/function-enquiry', {
        method: 'POST',
        body: JSON.stringify({ venue, ...form })
      });
      setSubmitted(true);
    } catch {
      // Endpoint not deployed yet — fall back to localStorage queue so the
      // enquiry isn't lost. Venue team can drain it once API ships.
      try {
        const existing = JSON.parse(window.localStorage.getItem('alma.reserve.function-enquiries.v1') ?? '[]');
        existing.push({ venue, ...form, submittedAt: new Date().toISOString() });
        window.localStorage.setItem('alma.reserve.function-enquiries.v1', JSON.stringify(existing));
        setSubmitted(true);
      } catch {
        /* swallow */
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="function-enquiry-success">
        <div className="function-enquiry-success-icon" aria-hidden="true">✓</div>
        <div>
          <strong>Enquiry sent</strong>
          <p>Thanks — our events team will reply within 1 business day to discuss your function.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`function-enquiry-panel ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="function-enquiry-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>
          <strong>Function or event enquiry</strong>
          <small>For groups of 10+, birthdays, anniversaries, or private dining</small>
        </span>
        <span className="function-enquiry-chevron" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open ? (
        <form className="reserve-form function-enquiry-form" onSubmit={submit}>
          <div className="form-grid two">
            <Input label="Your name" required value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.currentTarget.value })} />
            <Input label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.currentTarget.value })} />
            <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.currentTarget.value })} placeholder="04xx xxx xxx" />
            <Input label="Event type" value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.currentTarget.value })} placeholder="Birthday, work do, anniversary…" />
            <Input label="Preferred date" type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.currentTarget.value })} />
            <Input label="Party size" type="number" min="10" max="200" required value={form.partySize} onChange={(e) => setForm({ ...form, partySize: e.currentTarget.value })} />
          </div>
          <Textarea
            label="Tell us more"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })}
            placeholder="Dietary requirements, dining style, special requests…"
          />
          <div className="toolbar-right">
            <Button type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Send enquiry'}</Button>
          </div>
          <p className="subtle" style={{ fontSize: 12, margin: 0 }}>
            We typically reply within 1 business day. For urgent bookings, please call the venue directly.
          </p>
        </form>
      ) : null}
    </div>
  );
}

function PublicBookingWidget() {
  // Public booking widget redesigned per the Claude Design handoff
  // (reservation-widget.jsx). Four-step flow: venue + date + party →
  // time → details → confirmation ticket. The API contract is unchanged
  // — same /api/reserve/public-widget/{config,availability,book} —
  // only the UI changes. See styles.css `.alma-booking-page` block.
  const [config, setConfig] = useState<ReservePublicWidgetConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);

  const today = useMemo(() => {
    const value = new Date();
    value.setHours(0, 0, 0, 0);
    return value;
  }, []);
  const [venue, setVenue] = useState<string>('Alma Avalon');
  const [dateIdx, setDateIdx] = useState(0);
  const [partySize, setPartySize] = useState(2);

  const [availability, setAvailability] = useState<ReservePublicAvailabilityResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<ReservePublicAvailabilityResponse['slots'][number] | null>(null);

  const [guest, setGuest] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    area: '',
    dietaryTags: [] as string[],
    occasion: null as string | null,
    kitchenNote: '',
    marketingOptIn: false
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reservation, setReservation] = useState<ReservePublicBookingConfirmation | null>(null);
  const [widgetDrinksIntentId, setWidgetDrinksIntentId] = useState<string | null>(null);

  // Waitlist (fully-booked alternate state) — guest leaves name + phone
  // and the host follows up when a table opens. Same panel as step 2;
  // the form swaps in when slotsForDay is empty.
  const [waitlistName, setWaitlistName] = useState('');
  const [waitlistPhone, setWaitlistPhone] = useState('');
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [waitlistSubmittedAt, setWaitlistSubmittedAt] = useState<string | null>(null);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nextConfig = await api<ReservePublicWidgetConfig>('/api/reserve/public-widget/config');
        if (cancelled) return;
        setConfig(nextConfig);
        const firstOnline = nextConfig.venues.find((v) => v.onlineEnabled);
        const fallback = firstOnline ?? nextConfig.venues[0];
        if (fallback?.name) setVenue(fallback.name);
      } catch (error) {
        if (cancelled) return;
        setConfigError(error instanceof Error ? error.message : 'Could not load booking page');
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 90-day rolling release. The pill row scrolls horizontally; the
  // native date picker above lets guests jump straight to a date.
  const BOOKING_WINDOW_DAYS = 90;
  const calendar = useMemo(() => {
    return Array.from({ length: BOOKING_WINDOW_DAYS }, (_, offset) => {
      const date = new Date(today);
      date.setDate(date.getDate() + offset);
      return date;
    });
  }, [today]);
  const calendarMinIso = useMemo(() => calendar[0]!.toISOString().slice(0, 10), [calendar]);
  const calendarMaxIso = useMemo(
    () => calendar[calendar.length - 1]!.toISOString().slice(0, 10),
    [calendar]
  );

  const selectedDate = calendar[dateIdx] ?? calendar[0]!;
  const venueAccent = venueAccentFor(venue);
  const venueTagline = venueTaglineFor(venue);
  const venueOptions = useMemo(() => {
    const fromConfig = (config?.venues ?? []).map((entry) => ({
      name: entry.name,
      tagline: venueTaglineFor(entry.name),
      accent: venueAccentFor(entry.name),
      onlineEnabled: entry.onlineEnabled
    }));
    if (fromConfig.length) return fromConfig;
    return [
      { name: 'Alma Avalon', tagline: 'Restaurant & Bar', accent: '#3D5C3F', onlineEnabled: true },
      { name: 'St Alma', tagline: 'Freshwater dining', accent: '#A0463A', onlineEnabled: true }
    ];
  }, [config]);

  const isOversize = partySize >= 8;

  const requestAvailability = useCallback(async () => {
    setSearching(true);
    setAvailabilityError(null);
    setSelectedSlot(null);
    try {
      const date = toDateInput(selectedDate);
      const next = await api<ReservePublicAvailabilityResponse>('/api/reserve/public-widget/availability', {
        method: 'POST',
        body: JSON.stringify({
          venue,
          date: `${date}T00:00:00`,
          partySize,
          servicePeriod: 'DINNER'
        })
      });
      setAvailability(next);
      return next;
    } catch (error) {
      setAvailabilityError(error instanceof Error ? error.message : 'Could not check availability');
      setAvailability(null);
      return null;
    } finally {
      setSearching(false);
    }
  }, [selectedDate, venue, partySize]);

  async function goToTimes() {
    if (isOversize) {
      const target = document.getElementById('alma-booking-function-enquiry');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const result = await requestAvailability();
    if (result) setStep(1);
  }

  function pickSlot(slot: ReservePublicAvailabilityResponse['slots'][number]) {
    if (slot.capacityRemaining <= 0) return;
    setSelectedSlot(slot);
  }

  async function submitBooking(drinksIntentId?: string) {
    if (!selectedSlot) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await api<ReservePublicBookingConfirmation>('/api/reserve/public-widget/book', {
        method: 'POST',
        body: JSON.stringify({
          venue,
          availabilityRuleId: selectedSlot.availabilityRuleId || '',
          serviceDate: `${toDateInput(selectedDate)}T00:00:00`,
          startsAt: selectedSlot.startsAt,
          partySize,
          durationMinutes: Math.max(60, Math.round((new Date(selectedSlot.endsAt).getTime() - new Date(selectedSlot.startsAt).getTime()) / 60_000)),
          firstName: guest.firstName.trim(),
          lastName: guest.lastName.trim(),
          email: guest.email.trim(),
          phone: guest.phone.trim(),
          occasion: guest.occasion ?? '',
          area: guest.area || undefined,
          dietaryNotes: guest.dietaryTags.join(', '),
          specialRequests: guest.kitchenNote.trim(),
          marketingOptIn: guest.marketingOptIn,
          drinksPaymentIntentId: drinksIntentId || widgetDrinksIntentId || undefined
        })
      });
      setReservation(created);
      setStep(3);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not confirm booking');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitWaitlist() {
    if (!waitlistName.trim() || waitlistPhone.trim().length < 6) {
      setWaitlistError('Add a name and a phone number we can reach you on.');
      return;
    }
    setWaitlistSubmitting(true);
    setWaitlistError(null);
    try {
      // Window is the whole selected day — start at the venue's
      // service-start time (we don't know exact slots, so use the
      // calendar date 00:00 → 23:59). The host filters by venue +
      // date on the manager waitlist view.
      const startsAt = new Date(selectedDate);
      startsAt.setHours(0, 0, 0, 0);
      const endsAt = new Date(selectedDate);
      endsAt.setHours(23, 59, 59, 999);
      await api('/api/reserve/public-widget/waitlist', {
        method: 'POST',
        body: JSON.stringify({
          venue,
          guestName: waitlistName.trim(),
          guestPhone: waitlistPhone.trim(),
          partySize,
          windowStartsAt: startsAt.toISOString(),
          windowEndsAt: endsAt.toISOString()
        })
      });
      setWaitlistSubmittedAt(new Date().toISOString());
    } catch (error) {
      setWaitlistError(error instanceof Error ? error.message : 'Could not join the waitlist.');
    } finally {
      setWaitlistSubmitting(false);
    }
  }

  function restart() {
    setStep(0);
    setSelectedSlot(null);
    setReservation(null);
    setWidgetDrinksIntentId(null);
    setAvailability(null);
    setGuest({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      area: '',
      dietaryTags: [],
      occasion: null,
      kitchenNote: '',
      marketingOptIn: false
    });
  }

  // Backend schema requires first + last + phone — keep client validation
  // in sync so we don't enable the Confirm button on a payload that the
  // server will reject (reservePublicBookingInputSchema in @alma/shared).
  const detailsValid = guest.firstName.trim().length > 0
    && guest.lastName.trim().length > 0
    && guest.phone.trim().length >= 6;
  const ticketStripeStyle = { ['--abk-venue-accent' as string]: venueAccent } as React.CSSProperties;
  const slotsForDay = availability?.slots ?? [];

  return (
    <main className="alma-booking-page">
      <div className="alma-booking-layout">
        <section className="alma-booking-hero" aria-label="About Alma">
          <div className="alma-booking-hero__eyebrow">alma · reserve a table</div>
          <h1 className="alma-booking-hero__display">
            Save a table
            <br />
            <em>for tonight.</em>
          </h1>
          <p className="alma-booking-hero__tag">
            Coastal dining at {venue}. Bookings open 3 months ahead.
            Walk-ins welcome on the bar &amp; terrace from 5pm.
          </p>
          <div className="alma-booking-hero__policy" aria-label="House policy">
            <span className="alma-booking-hero__policy-pill">3-month rolling release</span>
            <span className="alma-booking-hero__policy-pill">2-hour seating</span>
            <span className="alma-booking-hero__policy-pill">24-hour cancellation</span>
          </div>
          <div className="alma-booking-hero__links">
            <a className="alma-booking-hero__link" href="https://www.almagroup.com.au/menu">See the menu</a>
            <a className="alma-booking-hero__link" href="#alma-booking-function-enquiry">Functions &amp; private dining</a>
          </div>
        </section>

        <aside className="alma-booking-card" aria-label="Book a table">
          <header className="alma-booking-card__head">
            <a href="https://www.almagroup.com.au/" className="alma-booking-card__brand" aria-label="Alma Group">
              <img src="/images/alma-group-logo.png" alt="Alma Group" />
            </a>
            {step < 3 ? (
              <div className="alma-booking-progress" aria-label={`Step ${step + 1} of 4`}>
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={
                      i === step
                        ? 'alma-booking-progress__dot alma-booking-progress__dot--active'
                        : i < step
                          ? 'alma-booking-progress__dot alma-booking-progress__dot--filled'
                          : 'alma-booking-progress__dot'
                    }
                  />
                ))}
              </div>
            ) : (
              <span className="alma-booking-status">Confirmed</span>
            )}
          </header>

          {loadingConfig ? <div className="alma-booking-loading">Loading availability…</div> : null}
          {configError && !loadingConfig ? (
            <div className="alma-booking-error">{configError}</div>
          ) : null}

          {!loadingConfig && !configError && step === 0 ? (
            <div>
              <div className="alma-booking-step__eyebrow">Step one · when</div>
              <h2 className="alma-booking-step__headline">
                Where would you like
                <br /><em>to come to dinner?</em>
              </h2>

              <div className="alma-booking-field">
                <div className="alma-booking-field__eyebrow">Venue</div>
                <div className="alma-booking-venues">
                  {venueOptions.map((v) => {
                    const active = v.name === venue;
                    const style = { ['--abk-venue-accent' as string]: v.accent } as React.CSSProperties;
                    return (
                      <button
                        key={v.name}
                        type="button"
                        className={`alma-booking-venue ${active ? 'alma-booking-venue--active' : ''}`}
                        onClick={() => { setVenue(v.name); setGuest((g) => ({ ...g, area: '' })); }}
                        aria-pressed={active}
                        style={style}
                      >
                        <span className="alma-booking-venue__label">{v.name}</span>
                        <div className="alma-booking-venue__tagline">{v.tagline}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="alma-booking-field">
                <div className="alma-booking-field__eyebrow alma-booking-field__eyebrow--row">
                  <span>Day</span>
                  <label className="alma-booking-date-jump">
                    <span className="visually-hidden">Pick a date</span>
                    <input
                      type="date"
                      value={selectedDate.toISOString().slice(0, 10)}
                      min={calendarMinIso}
                      max={calendarMaxIso}
                      onChange={(event) => {
                        const next = event.currentTarget.value;
                        if (!next) return;
                        const idx = calendar.findIndex(
                          (date) => date.toISOString().slice(0, 10) === next
                        );
                        if (idx >= 0) setDateIdx(idx);
                      }}
                    />
                  </label>
                </div>
                <div className="alma-booking-calendar">
                  {calendar.map((date, index) => {
                    const isToday = index === 0;
                    const selected = index === dateIdx;
                    return (
                      <button
                        key={date.toISOString()}
                        type="button"
                        className={`alma-booking-day ${selected ? 'alma-booking-day--active' : ''}`}
                        onClick={() => setDateIdx(index)}
                        aria-pressed={selected}
                      >
                        <div className="alma-booking-day__dow">{date.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                        <div className="alma-booking-day__num">{date.getDate()}</div>
                        {isToday && !selected ? <div className="alma-booking-day__today-mark" aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="alma-booking-field">
                <div className="alma-booking-field__eyebrow">How many of you?</div>
                <div className="alma-booking-party">
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => {
                    // The "7+" pill maps to partySize 8 so the >= 8
                    // oversize branch (function enquiry) actually triggers
                    // — otherwise a party of 7 books online as if it
                    // were a small group.
                    const stored = n === 7 ? 8 : n;
                    const active = partySize === stored;
                    return (
                      <button
                        key={n}
                        type="button"
                        className={`alma-booking-party__pill ${active ? 'alma-booking-party__pill--active' : ''}`}
                        onClick={() => setPartySize(stored)}
                        aria-pressed={active}
                        aria-label={n === 7 ? '7 or more guests' : `${n} guests`}
                      >
                        {n === 7 ? <>7<em>+</em></> : n}
                      </button>
                    );
                  })}
                </div>
                {isOversize ? (
                  <div className="alma-booking-party__overflow">
                    For parties of 7 or more we'll set up a private booking —
                    please <a href="tel:+61299184476">call us</a> or <a href="#alma-booking-function-enquiry">send a note</a>.
                  </div>
                ) : null}
              </div>

              <div className="alma-booking-actions">
                <span />
                <button
                  type="button"
                  className="alma-booking-btn"
                  onClick={() => void goToTimes()}
                  disabled={searching}
                >
                  {searching ? 'Checking…' : isOversize ? 'Send a function enquiry' : 'Next: pick a time'}
                  <AlmaBookingArrow />
                </button>
              </div>
              {availabilityError ? <div className="alma-booking-error" style={{ marginTop: 16 }}>{availabilityError}</div> : null}
            </div>
          ) : null}

          {!loadingConfig && !configError && step === 1 ? (
            <div>
              <div className="alma-booking-step__eyebrow">Step two · time</div>
              {slotsForDay.length > 0 ? (
                <>
                  <h2 className="alma-booking-step__headline">
                    We have <em>these times</em>
                    <br />for you.
                  </h2>
                  <div className="alma-booking-step__context">
                    {venue} · {selectedDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · party of {partySize}
                  </div>
                  <div className="alma-booking-times">
                    {slotsForDay.map((slot) => {
                      const isFull = slot.capacityRemaining <= 0;
                      const isLimited = !isFull && slot.capacityRemaining <= 2;
                      const isActive = selectedSlot?.startsAt === slot.startsAt;
                      return (
                        <button
                          key={slot.startsAt}
                          type="button"
                          disabled={isFull}
                          onClick={() => pickSlot(slot)}
                          className={`alma-booking-time ${isActive ? 'alma-booking-time--active' : ''} ${isFull ? 'alma-booking-time--full' : ''} ${isLimited ? 'alma-booking-time--limited' : ''}`}
                          aria-pressed={isActive}
                        >
                          <div className="alma-booking-time__label">{slot.label}</div>
                          <div className="alma-booking-time__status">
                            {isFull ? 'Full' : isLimited ? 'Limited' : 'Open'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <h2 className="alma-booking-step__headline">
                    We're <em>fully booked</em>
                    <br />for {selectedDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}.
                  </h2>
                  <div className="alma-booking-step__context">
                    {waitlistSubmittedAt
                      ? "You're on the list — we'll text the moment a table opens."
                      : "Leave your name and number and we'll text the moment a table opens."}
                  </div>
                  {!waitlistSubmittedAt ? (
                    <form
                      className="alma-booking-grid"
                      style={{ marginTop: 16 }}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submitWaitlist();
                      }}
                    >
                      <label>
                        <span className="alma-booking-field__eyebrow">Your name</span>
                        <input
                          className="alma-booking-input"
                          required
                          value={waitlistName}
                          onChange={(event) => setWaitlistName(event.currentTarget.value)}
                          placeholder="First name"
                        />
                      </label>
                      <label>
                        <span className="alma-booking-field__eyebrow">Phone</span>
                        <input
                          className="alma-booking-input"
                          required
                          type="tel"
                          value={waitlistPhone}
                          onChange={(event) => setWaitlistPhone(event.currentTarget.value)}
                          placeholder="04xx xxx xxx"
                        />
                      </label>
                      {waitlistError ? (
                        <div className="alma-booking-error" style={{ gridColumn: '1 / -1' }}>{waitlistError}</div>
                      ) : null}
                      <div className="alma-booking-actions" style={{ gridColumn: '1 / -1' }}>
                        <span />
                        <button
                          type="submit"
                          className="alma-booking-btn"
                          disabled={waitlistSubmitting}
                        >
                          {waitlistSubmitting ? 'Sending…' : 'Join the waitlist'}
                          <AlmaBookingArrow />
                        </button>
                      </div>
                    </form>
                  ) : null}
                  <div className="alma-booking-waitlist-banner">
                    <span className="alma-booking-waitlist-banner__dot" aria-hidden="true" />
                    <div className="alma-booking-waitlist-banner__body">
                      Walk-ins welcome at the bar &amp; terrace from 5pm. For a guaranteed table,
                      try a weeknight or pick a date further out.
                    </div>
                  </div>
                </>
              )}

              <div className="alma-booking-note">
                <span className="alma-booking-note__dot" aria-hidden="true" />
                <div>
                  <div className="alma-booking-note__title">Don't see your time?</div>
                  <div className="alma-booking-note__body">
                    Walk-ins are welcome at the bar from 5pm. Or pick a different day on the previous step.
                  </div>
                </div>
              </div>

              <div className="alma-booking-actions">
                <button type="button" className="alma-booking-btn alma-booking-btn--link" onClick={() => setStep(0)}>← Back</button>
                <button
                  type="button"
                  className="alma-booking-btn"
                  onClick={() => setStep(2)}
                  disabled={!selectedSlot}
                  aria-disabled={!selectedSlot}
                >
                  Next: your details
                  <AlmaBookingArrow />
                </button>
              </div>
            </div>
          ) : null}

          {!loadingConfig && !configError && step === 2 ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!detailsValid) return;
                void submitBooking();
              }}
            >
              <div className="alma-booking-step__eyebrow">Step three · the rest</div>
              <h2 className="alma-booking-step__headline">
                A few <em>last details,</em>
                <br />then we're set.
              </h2>
              <div className="alma-booking-step__context">
                {venue} · {selectedDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · {selectedSlot ? new Date(selectedSlot.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'select a time'} · {partySize} guests
              </div>

              {(() => {
                const venueCfg = config?.venues.find((v) => v.name === venue);
                const venuePackages = venueCfg?.drinkPackages ?? [];
                if (!venuePackages.length) return null;
                if (widgetDrinksIntentId) {
                  return (
                    <div className="drinks-paid-note" style={{ marginTop: 16 }}>
                      ✓ Drinks pre-paid — confirm your booking below.{' '}
                      <button type="button" className="drinks-pay__back" onClick={() => setWidgetDrinksIntentId(null)}>Remove</button>
                    </div>
                  );
                }
                return (
                  <div style={{ marginTop: 16 }}>
                    <DrinksPaymentPanel
                      venue={venue}
                      packages={venuePackages.map((p) => ({ id: p.id, name: p.name, description: p.description, priceCents: p.priceCents }))}
                      guestEmail={guest.email}
                      onPaid={(id) => setWidgetDrinksIntentId(id)}
                    />
                  </div>
                );
              })()}

              {(() => {
                const venueAreas = config?.venues.find((v) => v.name === venue)?.areas ?? [];
                if (!venueAreas.length) return null;
                return (
                  <div className="alma-booking-field">
                    <label>
                      <span className="alma-booking-field__eyebrow">Area</span>
                      <select
                        className="alma-booking-input"
                        value={guest.area}
                        onChange={(event) => { const el = event.currentTarget; setGuest((g) => ({ ...g, area: el.value })); }}
                      >
                        <option value="">No preference</option>
                        {venueAreas.map((area) => (
                          <option key={area} value={area}>{area}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                );
              })()}

              <div className="alma-booking-grid">
                <label>
                  <span className="alma-booking-field__eyebrow">Your name</span>
                  <input
                    className="alma-booking-input"
                    required
                    value={guest.firstName}
                    onChange={(event) => { const el = event.currentTarget; setGuest((g) => ({ ...g, firstName: el.value })); }}
                    placeholder="First name"
                  />
                </label>
                <label>
                  <span className="alma-booking-field__eyebrow">Phone</span>
                  <input
                    className="alma-booking-input"
                    required
                    type="tel"
                    value={guest.phone}
                    onChange={(event) => { const el = event.currentTarget; setGuest((g) => ({ ...g, phone: el.value })); }}
                    placeholder="04xx xxx xxx"
                  />
                </label>
                <label>
                  <span className="alma-booking-field__eyebrow">Last name</span>
                  <input
                    className="alma-booking-input"
                    required
                    value={guest.lastName}
                    onChange={(event) => { const el = event.currentTarget; setGuest((g) => ({ ...g, lastName: el.value })); }}
                    placeholder="Last name"
                  />
                </label>
                <label>
                  <span className="alma-booking-field__eyebrow">Email</span>
                  <input
                    className="alma-booking-input"
                    type="email"
                    value={guest.email}
                    onChange={(event) => { const el = event.currentTarget; setGuest((g) => ({ ...g, email: el.value })); }}
                    placeholder="for your confirmation"
                  />
                </label>
              </div>

              <div className="alma-booking-field">
                <div className="alma-booking-field__eyebrow">Anything we should know?</div>
                <div className="alma-booking-chips">
                  {ALMA_DIETARY_TAGS.map((tag) => {
                    const on = guest.dietaryTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`alma-booking-chip ${on ? 'alma-booking-chip--active' : ''}`}
                        onClick={() => setGuest((g) => ({
                          ...g,
                          dietaryTags: on ? g.dietaryTags.filter((t) => t !== tag) : [...g.dietaryTags, tag]
                        }))}
                        aria-pressed={on}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="alma-booking-field">
                <div className="alma-booking-field__eyebrow">Occasion · optional</div>
                <div className="alma-booking-chips">
                  {ALMA_OCCASIONS.map((occ) => {
                    const on = guest.occasion === occ;
                    return (
                      <button
                        key={occ}
                        type="button"
                        className={`alma-booking-chip alma-booking-chip--occasion ${on ? 'alma-booking-chip--active' : ''}`}
                        onClick={() => setGuest((g) => ({ ...g, occasion: on ? null : occ }))}
                        aria-pressed={on}
                      >
                        {occ}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="alma-booking-field">
                <label>
                  <span className="alma-booking-field__eyebrow">A note for the kitchen?</span>
                  <textarea
                    className="alma-booking-textarea"
                    rows={2}
                    value={guest.kitchenNote}
                    onChange={(event) => { const el = event.currentTarget; setGuest((g) => ({ ...g, kitchenNote: el.value })); }}
                    placeholder="e.g. We'd love a quiet corner. It's our first time."
                  />
                </label>
              </div>

              <label className="alma-booking-field" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
                <input
                  type="checkbox"
                  checked={guest.marketingOptIn}
                  onChange={(event) => { const el = event.currentTarget; setGuest((g) => ({ ...g, marketingOptIn: el.checked })); }}
                  style={{ width: 16, height: 16 }}
                />
                <span style={{ fontSize: 13, fontWeight: 500 }}>Save these for next time and send me occasional updates.</span>
              </label>

              {submitError ? <div className="alma-booking-error" style={{ marginTop: 16 }}>{submitError}</div> : null}

              <div className="alma-booking-actions">
                <button type="button" className="alma-booking-btn alma-booking-btn--link" onClick={() => setStep(1)}>← Back</button>
                <button
                  type="submit"
                  className="alma-booking-btn"
                  disabled={!detailsValid || submitting}
                >
                  {submitting ? 'Sending…' : widgetDrinksIntentId ? 'Confirm booking + drinks' : 'Confirm booking'}
                  <AlmaBookingArrow />
                </button>
              </div>
            </form>
          ) : null}

          {step === 3 && reservation ? (
            <div>
              <div className="alma-booking-step__eyebrow">Step four · all set</div>
              <h2 className="alma-booking-step__headline">
                You're <em>booked.</em>
              </h2>
              <div className="alma-booking-step__context">
                {guest.email ? `A confirmation is on its way to ${guest.email}. ` : ''}See you soon.
              </div>

              <div className="alma-booking-ticket" style={ticketStripeStyle}>
                <div className="alma-booking-ticket__stripe" />
                <div className="alma-booking-ticket__body">
                  <div className="alma-booking-ticket__head">
                    <div>
                      <div className="alma-booking-ticket__eyebrow">{venueTagline}</div>
                      <div className="alma-booking-ticket__title">
                        {firstWordOf(reservation.venue)} <em>{restOf(reservation.venue)}</em>
                      </div>
                    </div>
                    <span className="alma-booking-ticket__confirmed">
                      <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="#3F5739" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="2,7 6,11 12,3" />
                      </svg>
                      Confirmed
                    </span>
                  </div>
                  <div className="alma-booking-ticket__details">
                    <div>
                      <div className="alma-booking-ticket__field-label">When</div>
                      <div className="alma-booking-ticket__field-value">
                        {new Date(reservation.serviceDate).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                        <br />
                        <em>{new Date(reservation.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</em>
                      </div>
                    </div>
                    <div>
                      <div className="alma-booking-ticket__field-label">Party</div>
                      <div className="alma-booking-ticket__field-value">
                        {reservation.covers} guests
                        <br />
                        <em>{reservation.occasion || '—'}</em>
                      </div>
                    </div>
                    <div>
                      <div className="alma-booking-ticket__field-label">Reference</div>
                      <div className="alma-booking-ticket__ref">
                        ALMA-{reservation.id.slice(0, 6).toUpperCase()}
                      </div>
                    </div>
                  </div>
                  {guest.dietaryTags.length > 0 ? (
                    <div className="alma-booking-ticket__tags">
                      <div className="alma-booking-ticket__field-label">Kitchen note</div>
                      <div style={{ marginTop: 6 }}>
                        {guest.dietaryTags.map((tag) => (
                          <span key={tag} className="alma-booking-ticket__tag">{tag}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="alma-booking-ticket__footer">
                  {(() => {
                    const calendarHref = reservationCalendarHref(reservation);
                    return calendarHref ? (
                      <a
                        href={calendarHref}
                        download={`alma-booking-${reservation.id.slice(0, 6).toLowerCase()}.ics`}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                      >
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="2" y="3" width="12" height="11" rx="2" />
                          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
                        </svg>
                        Add to calendar
                      </a>
                    ) : null;
                  })()}
                  <button type="button" onClick={() => window.print()}>Print</button>
                  {reservation.manageUrl ? (
                    <a href={reservation.manageUrl} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Manage booking</a>
                  ) : null}
                  <button type="button" onClick={restart}>Make another booking</button>
                </div>
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      <section
        id="alma-booking-function-enquiry"
        style={{ width: '100%', maxWidth: 1200, margin: '0 auto', padding: '0 32px 56px' }}
        aria-label="Functions and large groups"
      >
        <FunctionEnquiryPanel venue={venue} />
      </section>
    </main>
  );
}

const ALMA_DIETARY_TAGS = ['Vegetarian', 'Vegan', 'Gluten-free', 'Shellfish allergy', 'Nut allergy', 'Dairy-free'];
const ALMA_OCCASIONS = ['Birthday', 'Anniversary', 'First date', 'Business', 'Just dinner'];

function AlmaBookingArrow() {
  return (
    <svg className="alma-booking-btn__arrow" viewBox="0 0 13 6" fill="none" aria-hidden="true">
      <path d="M0 3 H12 M9 0 L12 3 L9 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ManageBookingPage() {
  const token = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') ?? '' : '';
  const [view, setView] = useState<ReservePublicManageView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('This management link is missing.');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const next = await api<ReservePublicManageView>(`/api/reserve/public/manage/${encodeURIComponent(token)}`);
        setView(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your booking.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function cancel() {
    setCancelling(true);
    setError(null);
    try {
      const next = await api<ReservePublicManageView>(`/api/reserve/public/manage/${encodeURIComponent(token)}/cancel`, { method: 'POST' });
      setView(next);
      setConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the booking.');
    } finally {
      setCancelling(false);
    }
  }

  const whenLabel = view ? new Date(view.startsAt).toLocaleString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', minute: '2-digit'
  }) : '';

  return (
    <main className="alma-booking-page">
      <div className="alma-booking-layout" style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 720 }}>
        <aside className="alma-booking-card" style={{ justifySelf: 'center', width: '100%' }}>
          <header className="alma-booking-card__head">
            <div className="alma-booking-card__brand">alma <em>reserve</em></div>
            <span className="alma-booking-status">Manage</span>
          </header>

          {loading ? <div className="alma-booking-loading">Loading your booking…</div> : null}
          {error ? <div className="alma-booking-error">{error}</div> : null}

          {view ? (
            <div>
              <div className="alma-booking-step__eyebrow">Your booking</div>
              <h2 className="alma-booking-step__headline">
                {view.guestName.split(' ')[0] || 'You'} <em>at {view.venue}.</em>
              </h2>
              <div className="alma-booking-step__context">{whenLabel} · {view.covers} {view.covers === 1 ? 'guest' : 'guests'}</div>

              <div style={{ marginTop: 22, padding: '14px 16px', border: '1px solid var(--abk-hair)', borderRadius: 12, background: '#FFFFFF' }}>
                <div style={{ fontWeight: 700, fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--abk-ink-55)' }}>Status</div>
                <div style={{ marginTop: 6, fontFamily: '"Cormorant Garamond", Georgia, serif', fontStyle: 'italic', fontSize: 22, color: 'var(--abk-ink)' }}>
                  {view.status === 'CANCELLED' ? 'Cancelled' : view.status.replace('_', ' ').toLowerCase()}
                </div>
                {view.cancellationDeadline ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--abk-ink-55)' }}>
                    Free to cancel until {new Date(view.cancellationDeadline).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  </div>
                ) : null}
                {view.cancellationNotice ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--abk-cocoa)' }}>{view.cancellationNotice}</div>
                ) : null}
              </div>

              {view.cancellable && !confirm ? (
                <div className="alma-booking-actions">
                  <a href="https://alma-reserve.web.app/widget" className="alma-booking-btn alma-booking-btn--link">← Make another booking</a>
                  <button type="button" className="alma-booking-btn alma-booking-btn--ghost" onClick={() => setConfirm(true)}>
                    Cancel this booking
                  </button>
                </div>
              ) : null}

              {confirm && view.cancellable ? (
                <div className="alma-booking-note">
                  <span className="alma-booking-note__dot" aria-hidden="true" />
                  <div>
                    <div className="alma-booking-note__title">Sure you want to cancel?</div>
                    <div className="alma-booking-note__body">
                      We'll free the table for someone on the waitlist. This can't be undone — you'd need to make a new booking.
                    </div>
                    <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" className="alma-booking-btn alma-booking-btn--ghost" disabled={cancelling} onClick={() => setConfirm(false)}>
                        Keep my booking
                      </button>
                      <button type="button" className="alma-booking-btn" disabled={cancelling} onClick={() => void cancel()}>
                        {cancelling ? 'Cancelling…' : 'Yes, cancel it'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {view.status === 'CANCELLED' ? (
                <div className="alma-booking-actions">
                  <span />
                  <a href="https://alma-reserve.web.app/widget" className="alma-booking-btn">Book another time<AlmaBookingArrow /></a>
                </div>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function venueAccentFor(name: string) {
  const key = name.toLowerCase();
  if (key.includes('avalon')) return '#3D5C3F';
  if (key.includes('st alma') || key.includes('st. alma') || key.includes('freshwater')) return '#A0463A';
  return '#1F3524';
}

function venueTaglineFor(name: string) {
  const key = name.toLowerCase();
  if (key.includes('avalon')) return 'Restaurant & Bar';
  if (key.includes('st alma') || key.includes('st. alma') || key.includes('freshwater')) return 'Freshwater dining';
  return 'Alma Group';
}

function firstWordOf(value: string) {
  const parts = value.split(' ');
  if (parts.length <= 1) return value;
  return parts.slice(0, -1).join(' ');
}

function restOf(value: string) {
  const parts = value.split(' ');
  if (parts.length <= 1) return '';
  return parts[parts.length - 1] ?? '';
}

// Build a downloadable .ics for a confirmed booking so guests can drop it into
// Apple Calendar / Google Calendar / Outlook. UTC stamps (YYYYMMDDTHHMMSSZ),
// CRLF line breaks, and escaped text per RFC 5545.
function icsStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
function reservationCalendarHref(reservation: ReservePublicBookingConfirmation): string | null {
  const start = icsStamp(reservation.startsAt);
  if (!start) return null;
  // Fall back to a 2-hour sitting if the end time is missing.
  const end = icsStamp(reservation.endsAt) || icsStamp(new Date(new Date(reservation.startsAt).getTime() + 2 * 60 * 60 * 1000).toISOString());
  const ref = `ALMA-${reservation.id.slice(0, 6).toUpperCase()}`;
  const descParts = [
    `${reservation.covers} guest${reservation.covers === 1 ? '' : 's'}`,
    reservation.occasion ? `Occasion: ${reservation.occasion}` : '',
    `Reference: ${ref}`,
    reservation.manageUrl ? `Manage your booking: ${reservation.manageUrl}` : ''
  ].filter(Boolean);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Alma Reserve//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${reservation.id}@alma-reserve`,
    `DTSTAMP:${icsStamp(reservation.createdAt) || start}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsEscape(`Booking at ${reservation.venue}`)}`,
    `DESCRIPTION:${icsEscape(descParts.join('\n'))}`,
    `LOCATION:${icsEscape(reservation.venue)}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
}

function TopBarWithContext({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const [activeHash, setActiveHash] = useState(() => window.location.hash || '#dashboard');

  useEffect(() => {
    const sync = () => setActiveHash(window.location.hash || '#dashboard');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const active = resolveNavItem(activeHash);

  useEffect(() => {
    document.title = `${active.label} · Alma Reserve`;
  }, [active.label]);

  return (
    <TopBar
      title={active.label}
      subtitle={active.description}
      right={
        <>
          <SuiteAppSwitcher currentApp="reserve" apps={suiteApps} variant="topbar" />
          <SuiteInboxWidget
            appId="RESERVE"
            api={api}
            currentApp="reserve"
            venue={user.venue}
            userName={`${user.firstName} ${user.lastName}`}
            canAnnounce={user.role !== 'STAFF'}
          />
          <SuiteFeedbackWidget appId="RESERVE" api={api} userName={`${user.firstName} ${user.lastName}`} />
          <ThemeToggle />
          <SuiteClock />
          <SuiteSignOutButton onClick={() => void onLogout()} />
        </>
      }
    />
  );
}

function WaitlistSection({
  defaultVenue,
  venueOptions
}: {
  defaultVenue: string;
  venueOptions: Array<{ label: string; value: string }>;
}) {
  const [entries, setEntries] = useState<ReserveWaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    venue: defaultVenue,
    guestName: '',
    partySize: '2',
    phone: '',
    notes: '',
    estimatedWaitMinutes: ''
  });

  const reload = useCallback(async () => {
    try {
      const rows = await api<ReserveWaitlistEntry[]>('/api/reserve/waitlist');
      setEntries(rows ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the waitlist.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.guestName.trim() || busy) return;
    setBusy(true);
    try {
      const now = new Date();
      const est = draft.estimatedWaitMinutes ? Math.max(0, Number(draft.estimatedWaitMinutes)) : 30;
      const windowEndsAt = new Date(now.getTime() + est * 60000);
      await api('/api/reserve/waitlist', {
        method: 'POST',
        body: JSON.stringify({
          venue: draft.venue,
          guestName: draft.guestName.trim(),
          guestPhone: draft.phone.trim(),
          partySize: Math.max(1, Number(draft.partySize) || 1),
          windowStartsAt: now.toISOString(),
          windowEndsAt: windowEndsAt.toISOString(),
          notes: draft.notes.trim()
        })
      });
      setDraft({ venue: draft.venue, guestName: '', partySize: '2', phone: '', notes: '', estimatedWaitMinutes: '' });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add to the waitlist.');
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(id: string, status: ReserveWaitlistStatus) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/reserve/waitlist/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the entry.');
    } finally {
      setBusy(false);
    }
  }

  const waiting = entries.filter((e) => WAITLIST_WAITING.includes(e.status));
  const resolved = entries.filter((e) => !WAITLIST_WAITING.includes(e.status)).slice(0, 8);

  function timeSinceAdded(iso: string) {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
  }
  function estWaitMinutes(entry: ReserveWaitlistEntry): number | null {
    const span = Math.round((new Date(entry.windowEndsAt).getTime() - new Date(entry.windowStartsAt).getTime()) / 60000);
    return span > 0 ? span : null;
  }
  function resolvedLabel(status: ReserveWaitlistStatus): string {
    if (status === 'BOOKED') return 'Seated';
    if (status === 'EXPIRED') return 'Left without staying';
    return 'Cancelled';
  }

  return (
    <Card
      title="Waitlist"
      subtitle="Walk-in queue for peak service periods. Synced to the API, so it's the same on every host and device."
    >
      <form className="reserve-form" onSubmit={addEntry}>
        <div className="form-grid two">
          <Select
            label="Venue"
            value={draft.venue}
            onChange={(event) => setDraft({ ...draft, venue: event.currentTarget.value })}
            options={venueOptions.filter((o) => o.value !== 'all')}
          />
          <Input
            label="Guest name"
            required
            value={draft.guestName}
            onChange={(event) => setDraft({ ...draft, guestName: event.currentTarget.value })}
            placeholder="e.g. Jordan Lee"
          />
          <Input
            label="Party size"
            type="number"
            min="1"
            max="40"
            value={draft.partySize}
            onChange={(event) => setDraft({ ...draft, partySize: event.currentTarget.value })}
          />
          <Input
            label="Phone"
            value={draft.phone}
            onChange={(event) => setDraft({ ...draft, phone: event.currentTarget.value })}
            placeholder="04xx xxx xxx"
          />
          <Input
            label="Est. wait (min)"
            type="number"
            min="0"
            value={draft.estimatedWaitMinutes}
            onChange={(event) => setDraft({ ...draft, estimatedWaitMinutes: event.currentTarget.value })}
            placeholder="e.g. 30"
          />
          <Input
            label="Notes"
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.currentTarget.value })}
            placeholder="Window seat, bar OK..."
          />
        </div>
        {error ? <p className="reserve-error">{error}</p> : null}
        <div className="toolbar-right">
          <Button type="submit" disabled={busy}>Add to waitlist</Button>
        </div>
      </form>

      <div className="waitlist-stack">
        <div className="waitlist-section-head">
          <strong>Currently waiting · {waiting.length}</strong>
        </div>
        {loading ? (
          <EmptyState title="Loading…" description="Fetching the current waitlist." />
        ) : waiting.length === 0 ? (
          <EmptyState
            title="No one waiting"
            description="Add walk-ins as they arrive to track the queue and wait times."
          />
        ) : (
          waiting.map((entry) => {
            const est = estWaitMinutes(entry);
            const hasPhone = entry.guestPhone && entry.guestPhone !== '—';
            return (
              <div key={entry.id} className={`waitlist-row is-${entry.status.toLowerCase()}`}>
                <div className="waitlist-row-main">
                  <strong>{entry.guestName}{entry.status === 'NOTIFIED' ? ' · notified' : ''}</strong>
                  <span>{entry.partySize} {entry.partySize === 1 ? 'guest' : 'guests'} · {entry.venue}</span>
                  <small>
                    Added {timeSinceAdded(entry.createdAt)}
                    {est !== null ? ` · Est. wait ${est}m` : ''}
                    {hasPhone ? ` · ${entry.guestPhone}` : ''}
                  </small>
                  {entry.notes ? <em>{entry.notes}</em> : null}
                </div>
                <div className="waitlist-row-actions">
                  {entry.status !== 'NOTIFIED' ? (
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => updateStatus(entry.id, 'NOTIFIED')}>Notify</Button>
                  ) : null}
                  <Button type="button" size="sm" disabled={busy} onClick={() => updateStatus(entry.id, 'BOOKED')} title="Seats the party now and adds them to the live floor as a walk-in cover">Seat now</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => updateStatus(entry.id, 'EXPIRED')}>Left</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => updateStatus(entry.id, 'CANCELLED')}>Cancel</Button>
                </div>
              </div>
            );
          })
        )}

        {resolved.length > 0 ? (
          <>
            <div className="waitlist-section-head">
              <strong>Recent · {resolved.length}</strong>
            </div>
            {resolved.map((entry) => (
              <div key={entry.id} className={`waitlist-row is-${entry.status.toLowerCase()}`}>
                <div className="waitlist-row-main">
                  <strong>{entry.guestName}</strong>
                  <span>{entry.partySize} guests · {entry.venue}</span>
                  <small>{resolvedLabel(entry.status)} · added {timeSinceAdded(entry.createdAt)}</small>
                </div>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </Card>
  );
}

// Floor-plan geometry now lives on the server (ReserveTable.posX/posY/width/
// height/rotation/shape/seats), so the layout syncs across devices and hosts
// instead of being stuck in one browser's localStorage. The editor keeps an
// optimistic local copy while arranging, then persists the whole plan via
// PATCH /reserve/tables/layout on "Done arranging".
type TableShape = 'rect' | 'circle';
type TableGeo = {
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  shape: TableShape;
  seats: number;
};
export type TableLayoutUpdate = {
  id: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  shape: TableShape;
  seats: number;
};

const FLOOR_DEFAULT_W = 14;
const FLOOR_DEFAULT_H = 12;
const floorRound = (value: number) => Math.round(value * 10) / 10;
const floorClamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function seedTableGeo(table: ReserveTable, index: number): TableGeo {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return {
    posX: table.posX ?? 12 + col * 22,
    posY: table.posY ?? 16 + row * 22,
    width: table.width ?? FLOOR_DEFAULT_W,
    height: table.height ?? FLOOR_DEFAULT_H,
    rotation: table.rotation ?? 0,
    shape: table.shape === 'circle' ? 'circle' : 'rect',
    seats: table.seats ?? table.maxCovers
  };
}
function seedFloorGeometry(tables: ReserveTable[]): Record<string, TableGeo> {
  const out: Record<string, TableGeo> = {};
  tables.forEach((table, index) => {
    out[table.id] = seedTableGeo(table, index);
  });
  return out;
}

// ── In-service live floor map ───────────────────────────────────────────────
type ServiceStage = 'SEATED' | 'ENTREE' | 'MAINS' | 'DESSERT' | 'BILL';
type ServiceAction = 'SEAT' | 'STAGE' | 'CLEAR' | 'UNSEAT';
type ServiceReservation = {
  id: string;
  tableId: string | null;
  status: string;
  covers: number;
  guestName: string | null;
  startsAt: string;
  seatedAt: string | null;
  serviceStage: string | null;
  occasion: string | null;
};
type ServiceTone = 'free' | 'due' | 'seated' | 'entree' | 'mains' | 'dessert' | 'bill' | 'overdue';

const SERVICE_TURN_MINUTES = 120;
const SERVICE_STAGES: { key: ServiceStage; label: string }[] = [
  { key: 'SEATED', label: 'Seated' },
  { key: 'ENTREE', label: 'Entrée' },
  { key: 'MAINS', label: 'Mains' },
  { key: 'DESSERT', label: 'Dessert' },
  { key: 'BILL', label: 'Bill' }
];

function deriveServiceState(bookings: ServiceReservation[], nowMs: number): { tone: ServiceTone; reservation: ServiceReservation | null; minutes: number } {
  const active = bookings.filter((r) => r.status !== 'CANCELLED' && r.status !== 'NO_SHOW' && r.status !== 'COMPLETED');
  const seated = active.find((r) => r.status === 'SEATED');
  if (seated) {
    const minutes = seated.seatedAt ? Math.max(0, Math.floor((nowMs - new Date(seated.seatedAt).getTime()) / 60000)) : 0;
    const tone = (seated.serviceStage ?? 'SEATED').toLowerCase() as ServiceTone;
    const overdue = minutes >= SERVICE_TURN_MINUTES && tone !== 'bill';
    return { tone: overdue ? 'overdue' : tone, reservation: seated, minutes };
  }
  const due = active.find((r) => r.status === 'CONFIRMED' || r.status === 'PENDING');
  if (due) return { tone: 'due', reservation: due, minutes: 0 };
  return { tone: 'free', reservation: null, minutes: 0 };
}

const CALL_PRESETS: { type: ReserveTableCallType; label: string }[] = [
  { type: 'WATER', label: 'Water' },
  { type: 'CLEAR', label: 'Clear plates' },
  { type: 'ORDER', label: 'Ready to order' },
  { type: 'CHECK', label: 'Check on table' },
  { type: 'ATTENTION', label: 'Needs attention' }
];
const CALL_LABEL: Record<ReserveTableCallType, string> = {
  WATER: 'Water',
  CLEAR: 'Clear plates',
  ORDER: 'Ready to order',
  CHECK: 'Check on table',
  ATTENTION: 'Needs attention',
  CUSTOM: 'Note'
};
function callAgeLabel(iso: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));
  return mins < 1 ? 'just now' : `${mins}m`;
}

function squareMoney(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'AUD', maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

// Stable translucent tint per floor-plan zone (area name).
function zoneTint(area: string): string {
  let hash = 0;
  for (let i = 0; i < area.length; i += 1) hash = (hash * 31 + area.charCodeAt(i)) % 360;
  return `hsla(${hash}, 45%, 52%, 0.10)`;
}

function ServiceBoard({
  tables,
  reservations,
  onAction,
  busy,
  calls,
  onCall,
  onUpdateCall,
  squareOrders
}: {
  tables: ReserveTable[];
  reservations: ServiceReservation[];
  onAction: (reservationId: string, action: ServiceAction, stage?: ServiceStage) => void | Promise<void>;
  busy: boolean;
  calls: ReserveTableCall[];
  onCall: (table: ReserveTable, type: ReserveTableCallType, message?: string) => void | Promise<void>;
  onUpdateCall: (id: string, action: ReserveTableCallAction) => void | Promise<void>;
  squareOrders: ReserveSquareTableOrder[];
}) {
  const [now, setNow] = useState(() => Date.now());
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [customCall, setCustomCall] = useState('');
  const geometry = seedFloorGeometry(tables);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const byTable = new Map<string, ServiceReservation[]>();
  for (const r of reservations) {
    if (!r.tableId) continue;
    const list = byTable.get(r.tableId) ?? [];
    list.push(r);
    byTable.set(r.tableId, list);
  }

  const counts = { seated: 0, due: 0, overdue: 0, free: 0 };
  const states = new Map<string, ReturnType<typeof deriveServiceState>>();
  for (const table of tables) {
    const state = deriveServiceState(byTable.get(table.id) ?? [], now);
    states.set(table.id, state);
    if (state.tone === 'free') counts.free += 1;
    else if (state.tone === 'due') counts.due += 1;
    else if (state.tone === 'overdue') counts.overdue += 1;
    else counts.seated += 1;
  }

  const activeCalls = calls.filter((c) => c.status === 'OPEN' || c.status === 'ACKNOWLEDGED');
  const callsByTable = new Map<string, ReserveTableCall[]>();
  for (const call of activeCalls) {
    if (!call.tableId) continue;
    const list = callsByTable.get(call.tableId) ?? [];
    list.push(call);
    callsByTable.set(call.tableId, list);
  }

  const ordersByTable = new Map<string, ReserveSquareTableOrder>();
  for (const order of squareOrders) {
    if (order.tableId) ordersByTable.set(order.tableId, order);
  }

  const selected = selectedTableId ? tables.find((t) => t.id === selectedTableId) ?? null : null;
  const selectedState = selectedTableId ? states.get(selectedTableId) ?? null : null;
  const selectedReservation = selectedState?.reservation ?? null;
  const selectedCalls = selectedTableId ? callsByTable.get(selectedTableId) ?? [] : [];
  const selectedOrder = selectedTableId ? ordersByTable.get(selectedTableId) ?? null : null;

  if (tables.length === 0) {
    return <EmptyState title="No tables on the floor yet" description="Add tables in Settings → Tables and place them on the floor plan, then run service here." />;
  }

  return (
    <div className="service-board">
      <div className="service-board-summary">
        <span className="service-chip is-seated">{counts.seated} seated</span>
        <span className="service-chip is-overdue">{counts.overdue} overdue</span>
        <span className="service-chip is-due">{counts.due} due in</span>
        <span className="service-chip is-free">{counts.free} free</span>
        {activeCalls.length > 0 ? <span className="service-chip is-call">{activeCalls.length} call{activeCalls.length === 1 ? '' : 's'}</span> : null}
      </div>

      {activeCalls.length > 0 ? (
        <div className="service-calls-feed" aria-label="Active table calls">
          {activeCalls.map((call) => (
            <div key={call.id} className={`service-call-chip is-${call.status.toLowerCase()}`}>
              <button
                type="button"
                className="service-call-chip-main"
                onClick={() => { if (call.tableId) setSelectedTableId(call.tableId); }}
              >
                <strong>{call.tableLabel}</strong>
                <span>{call.type === 'CUSTOM' && call.message ? call.message : CALL_LABEL[call.type]}</span>
                <em>{callAgeLabel(call.createdAt, now)}</em>
              </button>
              {call.status === 'OPEN' ? (
                <button type="button" className="service-call-ack" disabled={busy} onClick={() => void onUpdateCall(call.id, 'ACKNOWLEDGE')}>Ack</button>
              ) : null}
              <button type="button" className="service-call-resolve" disabled={busy} onClick={() => void onUpdateCall(call.id, 'RESOLVE')}>Done</button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="service-board-layout">
        <div className="floor-plan-canvas service-canvas" onMouseDown={() => setSelectedTableId(null)}>
          {tables.map((table, index) => {
            const geo = geometry[table.id] ?? seedTableGeo(table, index);
            const state = states.get(table.id)!;
            const r = state.reservation;
            const isSelected = selectedTableId === table.id;
            return (
              <button
                type="button"
                key={table.id}
                className={`floor-plan-table service-table is-${state.tone} is-${geo.shape}${isSelected ? ' is-selected' : ''}${callsByTable.has(table.id) ? ' has-call' : ''}`}
                style={{
                  left: `${geo.posX}%`,
                  top: `${geo.posY}%`,
                  width: `${geo.width}%`,
                  height: `${geo.height}%`,
                  transform: `translate(-50%, -50%) rotate(${geo.rotation}deg)`
                }}
                onMouseDown={(event) => { event.stopPropagation(); setSelectedTableId(table.id); }}
              >
                <div className="floor-plan-table-inner" style={{ transform: `rotate(${-geo.rotation}deg)` }}>
                  {callsByTable.has(table.id) ? <span className="service-table-call-badge" aria-label="Active call">{callsByTable.get(table.id)!.length}</span> : null}
                  <span className="floor-plan-table-label">{table.label}</span>
                  {r ? (
                    <span className="service-table-meta">{r.guestName?.split(' ')[0] ?? 'Guest'} · {r.covers}p</span>
                  ) : (
                    <span className="service-table-meta is-subtle">{table.seats ?? table.maxCovers} seats</span>
                  )}
                  {r && r.status === 'SEATED' ? (
                    <span className="service-table-timer">{state.minutes}m</span>
                  ) : state.tone === 'due' && r ? (
                    <span className="service-table-timer">{new Date(r.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                  ) : null}
                  {ordersByTable.has(table.id) ? (
                    <span className="service-table-tab">{squareMoney(ordersByTable.get(table.id)!.totalCents)}</span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>

        {selected && selectedState ? (
          <aside className="service-panel">
            <div className="service-panel-head">
              <strong>{selected.label}</strong>
              <span className={`service-chip is-${selectedState.tone}`}>{selectedState.tone === 'free' ? 'Free' : selectedState.tone}</span>
            </div>
            {selectedReservation ? (
              <>
                <div className="service-panel-guest">
                  <strong>{selectedReservation.guestName ?? 'Guest'}</strong>
                  <span>
                    {selectedReservation.covers} guests · booked {new Date(selectedReservation.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    {selectedReservation.occasion ? ` · ${selectedReservation.occasion}` : ''}
                  </span>
                  {selectedReservation.status === 'SEATED' ? (
                    <span>Seated {selectedState.minutes} min ago{selectedState.tone === 'overdue' ? ' · over turn time' : ''}</span>
                  ) : null}
                </div>
                {selectedReservation.status === 'SEATED' ? (
                  <>
                    <div className="service-panel-stages">
                      {SERVICE_STAGES.map((stage) => (
                        <button
                          type="button"
                          key={stage.key}
                          disabled={busy}
                          className={(selectedReservation.serviceStage ?? 'SEATED') === stage.key ? 'is-active' : ''}
                          onClick={() => void onAction(selectedReservation.id, 'STAGE', stage.key)}
                        >
                          {stage.label}
                        </button>
                      ))}
                    </div>
                    <div className="service-panel-actions">
                      <button type="button" disabled={busy} className="service-clear" onClick={() => void onAction(selectedReservation.id, 'CLEAR')}>Clear table</button>
                      <button type="button" disabled={busy} className="service-ghost" onClick={() => void onAction(selectedReservation.id, 'UNSEAT')}>Unseat</button>
                    </div>
                  </>
                ) : (
                  <button type="button" disabled={busy} className="service-seat" onClick={() => void onAction(selectedReservation.id, 'SEAT')}>
                    Seat {selectedReservation.guestName?.split(' ')[0] ?? 'guest'}
                  </button>
                )}
              </>
            ) : (
              <p className="subtle">No booking on this table right now.</p>
            )}

            {selected ? (
              <div className="service-panel-calls">
                {selectedCalls.length > 0 ? (
                  <div className="service-panel-call-list">
                    {selectedCalls.map((call) => (
                      <div key={call.id} className={`service-call-row is-${call.status.toLowerCase()}`}>
                        <span>{call.type === 'CUSTOM' && call.message ? call.message : CALL_LABEL[call.type]} · {callAgeLabel(call.createdAt, now)}{call.status === 'ACKNOWLEDGED' ? ' · ack' : ''}</span>
                        <span className="service-call-row-actions">
                          {call.status === 'OPEN' ? (
                            <button type="button" disabled={busy} onClick={() => void onUpdateCall(call.id, 'ACKNOWLEDGE')}>Ack</button>
                          ) : null}
                          <button type="button" disabled={busy} onClick={() => void onUpdateCall(call.id, 'RESOLVE')}>Done</button>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <span className="service-panel-call-label">Send a call</span>
                <div className="service-call-presets">
                  {CALL_PRESETS.map((preset) => (
                    <button type="button" key={preset.type} disabled={busy} onClick={() => void onCall(selected, preset.type)}>
                      {preset.label}
                    </button>
                  ))}
                </div>
                <form
                  className="service-call-custom"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!customCall.trim()) return;
                    void onCall(selected, 'CUSTOM', customCall.trim());
                    setCustomCall('');
                  }}
                >
                  <input value={customCall} maxLength={200} placeholder="Custom call…" onChange={(event) => setCustomCall(event.currentTarget.value)} />
                  <button type="submit" disabled={busy || !customCall.trim()}>Send</button>
                </form>
              </div>
            ) : null}

            {selectedOrder ? (
              <div className="service-panel-tab">
                <div className="service-panel-tab-head">
                  <span className="service-panel-call-label">Open tab · Square</span>
                  <strong>{squareMoney(selectedOrder.totalCents)}</strong>
                </div>
                <ul className="service-tab-items">
                  {selectedOrder.lineItems.slice(0, 12).map((line, i) => (
                    <li key={i}>
                      <span>{Number(line.quantity) > 1 ? `${Number(line.quantity)}× ` : ''}{line.name}</span>
                      <span>{squareMoney(line.totalCents)}</span>
                    </li>
                  ))}
                  {selectedOrder.lineItems.length > 12 ? <li className="is-more">+{selectedOrder.lineItems.length - 12} more</li> : null}
                  {selectedOrder.lineItems.length === 0 ? <li className="is-more">{selectedOrder.itemCount} item{selectedOrder.itemCount === 1 ? '' : 's'}</li> : null}
                </ul>
              </div>
            ) : null}
          </aside>
        ) : (
          <aside className="service-panel service-panel--empty">
            <p className="subtle">Tap a table to seat guests, advance courses, or clear it. Colours show live status; the timer counts minutes since seating.</p>
          </aside>
        )}
      </div>
    </div>
  );
}

function FloorPlanSection({
  venue,
  tables,
  reservations,
  onAssignTable,
  onSaveLayout,
  onAutoAssign
}: {
  venue: string;
  tables: ReserveTable[];
  reservations: ReserveReservation[];
  onAssignTable: (reservationId: string, tableId: string | null) => void | Promise<void>;
  onSaveLayout: (updates: TableLayoutUpdate[]) => Promise<void>;
  onAutoAssign: () => void | Promise<void>;
}) {
  const [geometry, setGeometry] = useState<Record<string, TableGeo>>(() => seedFloorGeometry(tables));
  const [editMode, setEditMode] = useState(false);
  // Pure view filter — narrow the floor to a single area. 'all' shows everything.
  // Persisted in component state only; never touches saved data.
  const [areaFilter, setAreaFilter] = useState<string>('all');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const [draggingReservationId, setDraggingReservationId] = useState<string | null>(null);
  const [dropTargetTableId, setDropTargetTableId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState<boolean>(() => {
    try {
      return Boolean(JSON.parse(window.localStorage.getItem('alma.reserve.snapToGrid') ?? 'true'));
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('alma.reserve.snapToGrid', JSON.stringify(snapToGrid));
    } catch {
      // ignore storage failures (private mode etc.)
    }
  }, [snapToGrid]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const GRID_PCT = 2.5;
  const applySnap = (value: number) => (snapToGrid ? Math.round(value / GRID_PCT) * GRID_PCT : value);

  // Re-seed from the server when the table set changes — but never mid-edit,
  // so in-progress arranging isn't clobbered. After "Done arranging" the parent
  // reloads tables, which re-seeds from the saved geometry.
  useEffect(() => {
    if (editMode) return;
    setGeometry(seedFloorGeometry(tables));
  }, [tables, editMode]);

  const geoFor = (table: ReserveTable, index: number): TableGeo => geometry[table.id] ?? seedTableGeo(table, index);

  function patchGeo(tableId: string, patch: Partial<TableGeo>) {
    setGeometry((current) => {
      const base = current[tableId];
      if (!base) return current;
      return { ...current, [tableId]: { ...base, ...patch } };
    });
  }
  function resizeTable(tableId: string, direction: number) {
    setGeometry((current) => {
      const geo = current[tableId];
      if (!geo) return current;
      const step = 1.6 * direction;
      const width = floorClamp(floorRound(geo.width + step), 6, 30);
      const height = geo.shape === 'circle' ? width : floorClamp(floorRound(geo.height + step), 5, 28);
      return { ...current, [tableId]: { ...geo, width, height } };
    });
  }

  function handleTableMouseDown(event: ReactMouseEvent<HTMLDivElement>, tableId: string) {
    if (!editMode) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedTableId(tableId);
    setDraggingTableId(tableId);
  }
  function handleCanvasMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    if (!draggingTableId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = floorClamp(applySnap(((event.clientX - rect.left) / rect.width) * 100), 4, 96);
    const y = floorClamp(applySnap(((event.clientY - rect.top) / rect.height) * 100), 4, 94);
    patchGeo(draggingTableId, { posX: floorRound(x), posY: floorRound(y) });
  }

  function tidyToGrid() {
    setGeometry((current) => {
      const next: Record<string, TableGeo> = {};
      for (const [id, geo] of Object.entries(current)) {
        next[id] = {
          ...geo,
          posX: floorRound(Math.round(geo.posX / GRID_PCT) * GRID_PCT),
          posY: floorRound(Math.round(geo.posY / GRID_PCT) * GRID_PCT)
        };
      }
      return next;
    });
  }
  function handleCanvasMouseUp() {
    setDraggingTableId(null);
  }

  function handleReservationDragStart(event: DragEvent<HTMLElement>, reservationId: string) {
    event.dataTransfer.setData('text/plain', `reservation:${reservationId}`);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingReservationId(reservationId);
  }
  function handleTableDragOver(event: DragEvent<HTMLElement>, tableId: string) {
    if (!draggingReservationId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetTableId(tableId);
  }
  function handleTableDrop(event: DragEvent<HTMLElement>, tableId: string) {
    event.preventDefault();
    const data = event.dataTransfer.getData('text/plain');
    if (data.startsWith('reservation:')) {
      const reservationId = data.slice('reservation:'.length);
      void onAssignTable(reservationId, tableId);
    }
    setDraggingReservationId(null);
    setDropTargetTableId(null);
  }

  async function handleDoneArranging() {
    setSaving(true);
    try {
      const updates: TableLayoutUpdate[] = tables.map((table, index) => {
        const geo = geoFor(table, index);
        return {
          id: table.id,
          posX: geo.posX,
          posY: geo.posY,
          width: geo.width,
          height: geo.height,
          rotation: geo.rotation,
          shape: geo.shape,
          seats: geo.seats
        };
      });
      await onSaveLayout(updates);
      setEditMode(false);
      setSelectedTableId(null);
    } finally {
      setSaving(false);
    }
  }

  // Reservations: split into assigned (have tableId) and unassigned
  const reservationsByTable = new Map<string, ReserveReservation[]>();
  const unassignedReservations: ReserveReservation[] = [];
  for (const reservation of reservations) {
    if (reservation.tableId) {
      const list = reservationsByTable.get(reservation.tableId) ?? [];
      list.push(reservation);
      reservationsByTable.set(reservation.tableId, list);
    } else {
      unassignedReservations.push(reservation);
    }
  }

  const selectedIndex = selectedTableId ? tables.findIndex((t) => t.id === selectedTableId) : -1;
  const selectedTable = selectedIndex >= 0 ? tables[selectedIndex] : null;
  const selectedGeo = selectedTable ? geoFor(selectedTable, selectedIndex) : null;

  // Zones — derived from each table's area, drawn as labelled regions behind
  // the tables so the floor reads as grouped sections (Bar, Terrace, Dining…).
  const zones = (() => {
    const byArea = new Map<string, TableGeo[]>();
    tables.forEach((table, index) => {
      const geo = geoFor(table, index);
      const list = byArea.get(table.area) ?? [];
      list.push(geo);
      byArea.set(table.area, list);
    });
    const pad = 3;
    return Array.from(byArea.entries()).map(([area, geos]) => {
      const minX = Math.min(...geos.map((g) => g.posX - g.width / 2));
      const maxX = Math.max(...geos.map((g) => g.posX + g.width / 2));
      const minY = Math.min(...geos.map((g) => g.posY - g.height / 2));
      const maxY = Math.max(...geos.map((g) => g.posY + g.height / 2));
      return {
        area,
        left: Math.max(0, minX - pad),
        top: Math.max(0, minY - pad),
        width: Math.min(100, maxX - minX + pad * 2),
        height: Math.min(100, maxY - minY + pad * 2)
      };
    });
  })();

  // Distinct areas present on this floor, in first-seen order — drives the
  // filter chip row. If the active filter's area vanishes (e.g. venue switch),
  // fall back to 'all' for rendering.
  const floorAreas = Array.from(new Set(tables.map((t) => t.area)));
  const activeArea = areaFilter !== 'all' && floorAreas.includes(areaFilter) ? areaFilter : 'all';
  const areaMatches = (area: string) => activeArea === 'all' || area === activeArea;
  const visibleZones = zones.filter((zone) => areaMatches(zone.area));

  if (tables.length === 0) {
    return (
      <Card title="Floor plan" subtitle={`No tables configured for ${venue} yet — add tables in the Tables card first.`}>
        <EmptyState
          title="No tables to lay out"
          description="Once you add tables for this venue, drag them around to build your floor plan, then drop today's bookings onto specific tables."
        />
      </Card>
    );
  }

  return (
    <Card
      title="Floor plan"
      subtitle={`${tables.length} table${tables.length === 1 ? '' : 's'} at ${venue}. ${editMode ? 'Drag tables to move; tap one to change shape, size, rotation or seats. Tap Done to save.' : "Drag a booking from the side list onto a table to assign it. Tap Edit to rearrange."}`}
      action={
        <Button
          type="button"
          size="sm"
          variant={editMode ? 'primary' : 'secondary'}
          disabled={saving}
          onClick={() => {
            if (editMode) void handleDoneArranging();
            else setEditMode(true);
          }}
        >
          {saving ? 'Saving…' : editMode ? '✓ Done arranging' : '✎ Edit layout'}
        </Button>
      }
    >
      {editMode ? (
        <div className="floor-plan-editor-bar">
          <div className="floor-plan-editor-group">
            <button
              type="button"
              className={snapToGrid ? 'is-active' : ''}
              onClick={() => setSnapToGrid((value) => !value)}
              title="Snap tables to a grid while dragging"
            >⊞ Grid</button>
            <button type="button" onClick={tidyToGrid} title="Snap every table to the grid">Tidy</button>
          </div>
          {selectedTable && selectedGeo ? (
            <>
              <span className="floor-plan-editor-title">{selectedTable.label}</span>
              <div className="floor-plan-editor-group">
                <span>Shape</span>
                <button
                  type="button"
                  className={selectedGeo.shape === 'rect' ? 'is-active' : ''}
                  onClick={() => patchGeo(selectedTable.id, { shape: 'rect' })}
                  title="Rectangular"
                >▭</button>
                <button
                  type="button"
                  className={selectedGeo.shape === 'circle' ? 'is-active' : ''}
                  onClick={() => patchGeo(selectedTable.id, { shape: 'circle', height: selectedGeo.width })}
                  title="Round"
                >●</button>
              </div>
              <div className="floor-plan-editor-group">
                <span>Size</span>
                <button type="button" onClick={() => resizeTable(selectedTable.id, -1)} title="Smaller">−</button>
                <button type="button" onClick={() => resizeTable(selectedTable.id, 1)} title="Bigger">＋</button>
              </div>
              <div className="floor-plan-editor-group">
                <span>Rotate</span>
                <button type="button" onClick={() => patchGeo(selectedTable.id, { rotation: (selectedGeo.rotation + 15) % 360 })} title="Rotate 15°">⟳</button>
                <button type="button" onClick={() => patchGeo(selectedTable.id, { rotation: 0 })} title="Reset rotation">0°</button>
              </div>
              <div className="floor-plan-editor-group">
                <span>Seats</span>
                <button type="button" onClick={() => patchGeo(selectedTable.id, { seats: Math.max(1, selectedGeo.seats - 1) })}>−</button>
                <strong>{selectedGeo.seats}</strong>
                <button type="button" onClick={() => patchGeo(selectedTable.id, { seats: Math.min(30, selectedGeo.seats + 1) })}>＋</button>
              </div>
            </>
          ) : (
            <span className="subtle">Tap a table to change its shape, size, rotation or seats. Drag to move it.</span>
          )}
        </div>
      ) : null}
      {!editMode && floorAreas.length > 1 ? (
        <div className="floor-plan-area-filter" role="group" aria-label="Filter floor by area">
          <button
            type="button"
            className={activeArea === 'all' ? 'is-active' : ''}
            onClick={() => setAreaFilter('all')}
          >All areas</button>
          {floorAreas.map((area) => (
            <button
              key={area}
              type="button"
              className={activeArea === area ? 'is-active' : ''}
              onClick={() => setAreaFilter((current) => (current === area ? 'all' : area))}
            >{area}</button>
          ))}
        </div>
      ) : null}
      <div className="floor-plan-layout">
        {/* Canvas */}
        <div
          ref={canvasRef}
          className={`floor-plan-canvas ${editMode ? 'is-editing' : ''}${editMode && snapToGrid ? ' is-snap' : ''}`}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onMouseDown={() => { if (editMode) setSelectedTableId(null); }}
        >
          {(editMode ? zones : visibleZones).map((zone) => (
            <div
              key={zone.area}
              className="floor-plan-zone"
              style={{ left: `${zone.left}%`, top: `${zone.top}%`, width: `${zone.width}%`, height: `${zone.height}%`, background: zoneTint(zone.area) }}
            >
              <span className="floor-plan-zone-label">{zone.area}</span>
            </div>
          ))}
          {tables.map((table, index) => {
            // View-only area filter — hide tables outside the selected area.
            // Never filters while editing the layout (all tables stay editable).
            if (!editMode && !areaMatches(table.area)) return null;
            const geo = geoFor(table, index);
            const tableBookings = reservationsByTable.get(table.id) ?? [];
            const occupancy = tableBookings.length;
            const tone = occupancy === 0 ? 'free' : tableBookings.some((r) => r.status === 'SEATED') ? 'seated' : 'booked';
            const isDropTarget = dropTargetTableId === table.id;
            const isSelected = editMode && selectedTableId === table.id;
            return (
              <div
                key={table.id}
                className={`floor-plan-table is-${tone} is-${geo.shape}${isDropTarget ? ' is-drop-target' : ''}${draggingTableId === table.id ? ' is-dragging' : ''}${isSelected ? ' is-selected' : ''}`}
                style={{
                  left: `${geo.posX}%`,
                  top: `${geo.posY}%`,
                  width: `${geo.width}%`,
                  height: `${geo.height}%`,
                  transform: `translate(-50%, -50%) rotate(${geo.rotation}deg)`,
                  cursor: editMode ? 'move' : 'default'
                }}
                onMouseDown={(event) => handleTableMouseDown(event, table.id)}
                onDragOver={(event) => handleTableDragOver(event, table.id)}
                onDragLeave={() => setDropTargetTableId((current) => (current === table.id ? null : current))}
                onDrop={(event) => handleTableDrop(event, table.id)}
              >
                {/* Counter-rotate the content so labels stay upright. */}
                <div className="floor-plan-table-inner" style={{ transform: `rotate(${-geo.rotation}deg)` }}>
                  <span className="floor-plan-table-label">{table.label}</span>
                  <span className="floor-plan-seats" aria-label={`${geo.seats} seats`}>
                    {geo.seats <= 12 ? (
                      Array.from({ length: geo.seats }).map((_, i) => <i key={i} className="floor-plan-seat-dot" />)
                    ) : (
                      <small>{geo.seats} seats</small>
                    )}
                  </span>
                  {tableBookings.length > 0 ? (
                    <div className="floor-plan-table-bookings">
                      {tableBookings.slice(0, 2).map((r) => (
                        <span key={r.id} title={`${r.guestName} · ${r.covers} guests`}>
                          {r.guestName?.split(' ')[0] ?? 'Guest'} · {r.covers}p
                        </span>
                      ))}
                      {tableBookings.length > 2 ? <span>+{tableBookings.length - 2}</span> : null}
                    </div>
                  ) : (
                    <span className="floor-plan-table-area">{table.area}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Side panel: unassigned reservations to drag onto tables */}
        <aside className="floor-plan-side">
          <strong className="floor-plan-side-head">
            Today's bookings · {unassignedReservations.length} unassigned
          </strong>
          {unassignedReservations.length > 0 ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => void onAutoAssign()}>
              Auto-assign by party size →
            </Button>
          ) : (
            <p className="subtle">All of today's bookings have a table. Drag any one off a table to unassign — or open the booking to change.</p>
          )}
          {unassignedReservations.map((reservation) => (
            <div
              key={reservation.id}
              draggable
              className="floor-plan-reservation-chip"
              onDragStart={(event) => handleReservationDragStart(event, reservation.id)}
              onDragEnd={() => { setDraggingReservationId(null); setDropTargetTableId(null); }}
              title="Drag onto a table to assign"
            >
              <strong>{reservation.guestName || 'Guest'}</strong>
              <span>
                {reservation.covers} guest{reservation.covers === 1 ? '' : 's'} · {new Date(reservation.startsAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
              </span>
              <small>{reservation.servicePeriod.toLowerCase()} · {reservation.status.toLowerCase()}</small>
            </div>
          ))}

          {reservations.some((r) => r.tableId) ? (
            <>
              <strong className="floor-plan-side-head" style={{ marginTop: 14 }}>
                Assigned · {reservations.filter((r) => r.tableId).length}
              </strong>
              <p className="subtle" style={{ fontSize: 12 }}>
                Tap a booking on a table to unassign it.
              </p>
            </>
          ) : null}
        </aside>
      </div>
    </Card>
  );
}

function ReserveWorkspace({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const venueOptions = useMemo(() => effectiveVenueOptions(user), [user]);
  const initialVenue = firstManagerVenue(user, isAdmin(user) ? ALL_VENUES : user.venue);
  const [venueFilter, setVenueFilter] = useState(isAdmin(user) ? ALL_VENUES : initialVenue);
  const [selectedDate, setSelectedDate] = useState(todayInput());
  const [guestSearch, setGuestSearch] = useState('');
  const [feedback, setFeedback] = useState<FeedbackState>(defaultFeedback());
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<ReserveDashboardPayload | null>(null);
  const [diary, setDiary] = useState<ReserveDiarySummary | null>(null);
  const [guests, setGuests] = useState<ReserveGuest[]>([]);
  const [tables, setTables] = useState<ReserveTable[]>([]);
  const [rules, setRules] = useState<ReserveAvailabilityRule[]>([]);
  const [blackouts, setBlackouts] = useState<ReserveBlackout[]>([]);
  const [drinkPackages, setDrinkPackages] = useState<ReserveDrinkPackage[]>([]);
  const [drinkPackageForm, setDrinkPackageForm] = useState({
    venue: KNOWN_VENUES[0] ?? '',
    name: '',
    description: '',
    price: '',
    sortOrder: '0',
    isActive: true
  });
  // Bookable areas per venue (Inside/Outside/Bar etc.). Drives the booking
  // area picker, the table editor's area dropdown, and the floor-plan filter.
  const [areas, setAreas] = useState<ReserveArea[]>([]);
  const [areaForm, setAreaForm] = useState<{ id: string | null; venue: string; name: string; sortOrder: string; isActive: boolean }>({
    id: null,
    venue: KNOWN_VENUES[0] ?? '',
    name: '',
    sortOrder: '0',
    isActive: true
  });
  // When a manager pre-pays drinks on a booking, the confirmed PaymentIntent id
  // is held here until they hit Save booking.
  const [bookingDrinksIntentId, setBookingDrinksIntentId] = useState<string | null>(null);
  const [integration, setIntegration] = useState<GoogleReserveIntegrationSetting | null>(null);
  const [widgetConfig, setWidgetConfig] = useState<ReservePublicWidgetConfig | null>(null);
  const [widgetAvailability, setWidgetAvailability] = useState<ReservePublicAvailabilityResponse | null>(null);
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [guestDetail, setGuestDetail] = useState<MarketingGuestDetail | null>(null);
  // Track active section by hash so each Reserve tool gets its own page.
  // Defaults to #dashboard; SidebarNav already manages updating window.location.hash.
  const [activeHash, setActiveHash] = useState<string>(() =>
    (typeof window !== 'undefined' && window.location.hash) || '#dashboard'
  );
  useEffect(() => {
    const syncHash = () => setActiveHash(window.location.hash || '#dashboard');
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);
  const showDashboard = activeHash === '#dashboard' || activeHash === '';
  const showService = activeHash === '#service';
  const showGuests = activeHash === '#guests';
  const showWaitlist = activeHash === '#waitlist';
  const showWidget = activeHash === '#widget-preview';
  const showGoogleReserve = activeHash === '#google-reserve';
  const showSettings = SETTINGS_HASHES.includes(activeHash);
  const settingsTab: 'rules' | 'drinks' | 'areas' | 'tables' | 'floor-plan' =
    activeHash === '#drinks' ? 'drinks'
      : activeHash === '#areas' ? 'areas'
        : activeHash === '#tables' ? 'tables'
          : activeHash === '#floor-plan' ? 'floor-plan'
            : 'rules';
  const showAvailability = showSettings && settingsTab === 'rules';
  const showDrinks = showSettings && settingsTab === 'drinks';
  const showAreas = showSettings && settingsTab === 'areas';
  const showTables = showSettings && settingsTab === 'tables';
  const showFloorPlan = showSettings && settingsTab === 'floor-plan';
  // Recent visit history for the guest being booked — shown when the email
  // entered in the quick-create form matches an existing guest in this venue.
  const [formGuestHistory, setFormGuestHistory] = useState<{
    matchedGuest: ReserveGuest;
    recentReservations: ReserveReservation[];
  } | null>(null);

  const defaultVenue = firstManagerVenue(user, venueFilter);
  const [reservationForm, setReservationForm] = useState<ReservationForm>(() => defaultReservationForm(defaultVenue));
  const [tableForm, setTableForm] = useState<TableForm>(() => defaultTableForm(defaultVenue));
  const [ruleForm, setRuleForm] = useState<RuleForm>(() => defaultRuleForm(defaultVenue));
  const [blackoutForm, setBlackoutForm] = useState<BlackoutForm>(() => defaultBlackoutForm(defaultVenue));
  const [integrationForm, setIntegrationForm] = useState<GoogleReserveIntegrationSetting>(() => ({
    id: `virtual:${defaultVenue}`,
    venue: defaultVenue,
    enabled: false,
    merchantId: null,
    integrationStatus: 'SETUP_REQUIRED',
    lastSyncAt: null,
    lastError: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  }));
  const [widgetSearch, setWidgetSearch] = useState<WidgetSearchForm>(() => defaultWidgetSearch(defaultVenue));

  const scopedVenueParam = venueFilter === ALL_VENUES ? null : venueFilter;
  const diaryStart = useMemo(() => new Date(`${selectedDate}T00:00:00`), [selectedDate]);
  const diaryEnd = useMemo(() => addDays(diaryStart, 1), [diaryStart]);
  const currentReservations = diary?.reservations ?? [];

  const load = useCallback(async () => {
    setLoading(true);
    setFeedback(defaultFeedback());
    try {
      const venueQuery = scopedVenueParam ? `venue=${encodeURIComponent(scopedVenueParam)}` : '';
      const join = (path: string, params: string[]) => `${path}${params.filter(Boolean).length ? `?${params.filter(Boolean).join('&')}` : ''}`;

      const [nextDashboard, nextDiary, nextGuests, nextTables, nextRules, nextBlackouts, nextWidgetConfig, nextIntegration, nextDrinkPackages, nextAreas] =
        await Promise.all([
          api<ReserveDashboardPayload>(join('/api/reserve/dashboard', [venueQuery, `date=${encodeURIComponent(`${selectedDate}T00:00:00`)}`])),
          api<ReserveDiarySummary>(
            join('/api/reserve/diary', [
              venueQuery,
              `start=${encodeURIComponent(diaryStart.toISOString())}`,
              `end=${encodeURIComponent(diaryEnd.toISOString())}`
            ])
          ),
          api<ReserveGuest[]>(join('/api/reserve/guests', [venueQuery, guestSearch ? `search=${encodeURIComponent(guestSearch)}` : ''])),
          api<ReserveTable[]>(join('/api/reserve/tables', [venueQuery])),
          api<ReserveAvailabilityRule[]>(join('/api/reserve/availability-rules', [venueQuery])),
          api<ReserveBlackout[]>(join('/api/reserve/blackouts', [venueQuery])),
          api<ReservePublicWidgetConfig>('/api/reserve/public-widget/config'),
          scopedVenueParam ? api<GoogleReserveIntegrationSetting>(join('/api/reserve/google-reserve-settings', [venueQuery])) : Promise.resolve(null),
          api<ReserveDrinkPackage[]>(join('/api/reserve/drink-packages', [venueQuery])),
          api<ReserveArea[]>(join('/api/reserve/areas', [venueQuery]))
        ]);

      setDashboard(nextDashboard);
      setDiary(nextDiary);
      setGuests(nextGuests);
      setTables(nextTables);
      setRules(nextRules);
      setBlackouts(nextBlackouts);
      setWidgetConfig(nextWidgetConfig);
      setIntegration(nextIntegration);
      setDrinkPackages(nextDrinkPackages);
      setAreas(nextAreas);
      if (nextIntegration) setIntegrationForm(nextIntegration);
    } catch (error) {
      setFeedback({
        target: 'page',
        tone: 'error',
        message: error instanceof Error ? error.message : 'Could not load Reserve workspace'
      });
    } finally {
      setLoading(false);
    }
  }, [diaryEnd, diaryStart, guestSearch, scopedVenueParam, selectedDate]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live sync: lightweight background refresh of the floor plan + today's
  // bookings so other hosts' moves and table assignments appear without a manual
  // refresh. Pauses when the tab is hidden; the floor-plan editor ignores
  // incoming geometry while you're arranging (it only re-seeds when not editing).
  const refreshLive = useCallback(async () => {
    try {
      const venueQuery = scopedVenueParam ? `venue=${encodeURIComponent(scopedVenueParam)}` : '';
      const join = (path: string, params: string[]) =>
        `${path}${params.filter(Boolean).length ? `?${params.filter(Boolean).join('&')}` : ''}`;
      const [nextDashboard, nextTables] = await Promise.all([
        api<ReserveDashboardPayload>(
          join('/api/reserve/dashboard', [venueQuery, `date=${encodeURIComponent(`${selectedDate}T00:00:00`)}`])
        ),
        api<ReserveTable[]>(join('/api/reserve/tables', [venueQuery]))
      ]);
      setDashboard(nextDashboard);
      setTables(nextTables);
    } catch {
      /* background refresh — stay quiet on transient errors */
    }
  }, [scopedVenueParam, selectedDate]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void refreshLive();
    }, 25000);
    return () => window.clearInterval(id);
  }, [refreshLive]);

  // Pin the new-area form's venue to the scoped venue when a specific venue is
  // selected (the venue picker is only shown under "All venues"). Skips while
  // editing an existing area so its venue is preserved.
  useEffect(() => {
    if (scopedVenueParam) {
      setAreaForm((current) => (current.id || current.venue === scopedVenueParam ? current : { ...current, venue: scopedVenueParam }));
    }
  }, [scopedVenueParam]);

  // Live service-map table calls — polled while the Service view is open so the
  // same active calls show to everyone working the floor.
  const [calls, setCalls] = useState<ReserveTableCall[]>([]);
  const refreshCalls = useCallback(async () => {
    try {
      const venueQuery = scopedVenueParam ? `?venue=${encodeURIComponent(scopedVenueParam)}` : '';
      setCalls(await api<ReserveTableCall[]>(`/api/reserve/calls${venueQuery}`));
    } catch {
      /* background — stay quiet on transient errors */
    }
  }, [scopedVenueParam]);

  useEffect(() => {
    if (!showService) return;
    void refreshCalls();
    const id = window.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void refreshCalls();
    }, 10000);
    return () => window.clearInterval(id);
  }, [showService, refreshCalls]);

  async function sendTableCall(table: ReserveTable, type: ReserveTableCallType, message?: string) {
    try {
      await api('/api/reserve/calls', {
        method: 'POST',
        body: JSON.stringify({
          venue: table.venue,
          tableId: table.id,
          tableLabel: table.label,
          type,
          message: message?.trim() || undefined
        })
      });
      await refreshCalls();
    } catch (error) {
      setError('reservation', error, 'Could not send the call.');
    }
  }

  async function updateTableCall(id: string, action: ReserveTableCallAction) {
    try {
      await api(`/api/reserve/calls/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
      await refreshCalls();
    } catch (error) {
      setError('reservation', error, 'Could not update the call.');
    }
  }

  // Live Square open-ticket totals per table — polled while Service is open.
  const [squareOrders, setSquareOrders] = useState<ReserveSquareTableOrder[]>([]);
  const refreshSquareOrders = useCallback(async () => {
    try {
      const venueQuery = scopedVenueParam ? `?venue=${encodeURIComponent(scopedVenueParam)}` : '';
      const payload = await api<ReserveSquareOrdersPayload>(`/api/reserve/square-orders${venueQuery}`);
      setSquareOrders(payload.orders ?? []);
    } catch {
      /* background — Square may be disconnected; stay quiet */
    }
  }, [scopedVenueParam]);

  useEffect(() => {
    if (!showService) return;
    void refreshSquareOrders();
    const id = window.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void refreshSquareOrders();
    }, 15000);
    return () => window.clearInterval(id);
  }, [showService, refreshSquareOrders]);

  useEffect(() => {
    const nextVenue = firstManagerVenue(user, scopedVenueParam);
    setReservationForm(defaultReservationForm(nextVenue));
    setTableForm(defaultTableForm(nextVenue));
    setRuleForm(defaultRuleForm(nextVenue));
    setBlackoutForm(defaultBlackoutForm(nextVenue));
    setWidgetSearch(defaultWidgetSearch(nextVenue));
  }, [scopedVenueParam, user]);

  useEffect(() => {
    if (!selectedGuestId) {
      setGuestDetail(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const [guest, reservations, timeline] = await Promise.all([
          api<ReserveGuest>(`/api/reserve/guests/${selectedGuestId}`),
          api<ReserveReservation[]>(`/api/reserve/guests/${selectedGuestId}/reservations`),
          api<GuestTimelinePayload>(`/api/reserve/guests/${selectedGuestId}/timeline`)
        ]);
        if (!cancelled) setGuestDetail({ guest, reservations, timeline });
      } catch {
        if (!cancelled) setGuestDetail(null);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedGuestId]);

  // When the email in the quick-create reservation form matches an existing
  // guest, look up their recent reservations so we can show the last 3 visits
  // alongside the form. Debounced 350ms to avoid hammering the API on each
  // keystroke.
  useEffect(() => {
    const email = reservationForm.email.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      setFormGuestHistory(null);
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const matches = await api<ReserveGuest[]>(
          `/api/reserve/guests?search=${encodeURIComponent(email)}`
        );
        const match = matches.find((g) => g.email?.trim().toLowerCase() === email);
        if (!match) {
          setFormGuestHistory(null);
          return;
        }
        const recent = await api<ReserveReservation[]>(
          `/api/reserve/guests/${match.id}/reservations`
        );
        setFormGuestHistory({ matchedGuest: match, recentReservations: recent.slice(0, 3) });
      } catch {
        setFormGuestHistory(null);
      }
    }, 350);
    return () => window.clearTimeout(handle);
  }, [reservationForm.email]);

  // Active area names for a venue, sorted by sortOrder (then name) — drives the
  // booking area picker, table editor dropdown, and floor-plan filter.
  const areasForVenue = useCallback(
    (venue: string): string[] =>
      areas
        .filter((area) => area.venue === venue && area.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((area) => area.name),
    [areas]
  );

  // Quick-create table picker: filter by the chosen area when one is set.
  const bookingTables = reservationForm.area
    ? tables.filter((table) => table.area === reservationForm.area)
    : tables;
  const tableOptions = [{ label: 'Unassigned', value: '' }, ...bookingTables.map((table) => ({ label: `${table.label} · ${table.area}`, value: table.id }))];
  const ruleOptions = [{ label: 'None', value: '' }, ...rules.map((rule) => ({ label: `${rule.name} · ${rule.venue}`, value: rule.id }))];

  function setSuccess(target: string, message: string) {
    setFeedback({ target, message, tone: 'success' });
  }

  function setError(target: string, error: unknown, fallback: string) {
    setFeedback({
      target,
      message: error instanceof Error ? error.message : fallback,
      tone: 'error'
    });
  }

  const [serviceBusy, setServiceBusy] = useState(false);
  async function serviceAction(reservationId: string, action: ServiceAction, stage?: ServiceStage) {
    if (serviceBusy) return;
    setServiceBusy(true);
    try {
      await api(`/api/reserve/reservations/${reservationId}/service`, {
        method: 'PATCH',
        body: JSON.stringify({ action, stage })
      });
      await refreshLive();
    } catch (error) {
      setError('reservation', error, 'Could not update the table.');
    } finally {
      setServiceBusy(false);
    }
  }

  async function saveReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const startsAt = dateTime(reservationForm.serviceDate, reservationForm.time);
    const endsAt = new Date(startsAt.getTime() + Number(reservationForm.durationMinutes || 120) * 60_000);
    try {
      await api<ReserveReservation>('/api/reserve/reservations', {
        method: 'POST',
        body: JSON.stringify({
          venue: reservationForm.venue,
          serviceDate: `${reservationForm.serviceDate}T00:00:00`,
          servicePeriod: reservationForm.servicePeriod,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          covers: Number(reservationForm.covers || 1),
          area: reservationForm.area || undefined,
          tableId: reservationForm.tableId,
          availabilityRuleId: reservationForm.availabilityRuleId,
          status: reservationForm.status,
          guest: {
            venue: reservationForm.venue,
            firstName: reservationForm.firstName,
            lastName: reservationForm.lastName,
            email: reservationForm.email,
            phone: reservationForm.phone,
            marketingOptIn: reservationForm.marketingOptIn,
            tags: [],
            allergyNotes: '',
            visitNotes: '',
            notes: '',
            dietaryNotes: '',
            preferences: {},
            source: 'staff_created',
            birthday: ''
          },
          guestName: `${reservationForm.firstName} ${reservationForm.lastName}`.trim(),
          guestEmail: reservationForm.email,
          guestPhone: reservationForm.phone,
          occasion: reservationForm.occasion,
          specialRequests: reservationForm.specialRequests,
          internalNotes: reservationForm.internalNotes,
          marketingOptIn: reservationForm.marketingOptIn,
          drinksPaymentIntentId: bookingDrinksIntentId || undefined
        })
      });
      setReservationForm(defaultReservationForm(reservationForm.venue));
      setSuccess('reservation', bookingDrinksIntentId ? 'Booking saved with prepaid drinks.' : 'Booking saved to the live Reserve diary.');
      setBookingDrinksIntentId(null);
      await load();
    } catch (error) {
      setError('reservation', error, 'Could not save booking.');
    }
  }

  async function saveTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api<ReserveTable>('/api/reserve/tables', {
        method: 'POST',
        body: JSON.stringify({
          venue: tableForm.venue,
          area: tableForm.area,
          label: tableForm.label,
          minCovers: Number(tableForm.minCovers || 1),
          maxCovers: Number(tableForm.maxCovers || 2),
          sortOrder: Number(tableForm.sortOrder || 0),
          isActive: true
        })
      });
      setTableForm(defaultTableForm(tableForm.venue));
      setSuccess('table', 'Table saved.');
      await load();
    } catch (error) {
      setError('table', error, 'Could not save table.');
    }
  }

  async function updateReservationStatus(reservation: ReserveReservation, status: ReserveReservationStatus) {
    try {
      await api(`/api/reserve/reservations/${reservation.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      setSuccess(`reservation:${reservation.id}`, 'Reservation updated.');
      await load();
    } catch (error) {
      setError(`reservation:${reservation.id}`, error, 'Could not update reservation.');
    }
  }

  async function chargeNoShow(reservation: ReserveReservation) {
    const guest = reservation.guestName || fullName(reservation.guest) || 'this guest';
    if (!window.confirm(`Charge the no-show fee to ${guest}'s card on file? They'll be charged the venue's standard no-show fee for a party of ${reservation.covers}.`)) return;
    try {
      const result = await api<ReserveNoShowChargeResult>(`/api/reserve/reservations/${reservation.id}/charge-no-show`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      if (result.status === 'succeeded') {
        setSuccess(`reservation:${reservation.id}`, `No-show fee of $${(result.amountCents / 100).toFixed(2)} charged.`);
      } else if (result.status === 'requires_action') {
        setError(`reservation:${reservation.id}`, null, 'The card needs extra verification — the charge could not be completed automatically.');
      } else {
        setError(`reservation:${reservation.id}`, null, result.errorMessage || 'The no-show charge was declined.');
      }
      await load();
    } catch (error) {
      setError(`reservation:${reservation.id}`, error, 'Could not charge the no-show fee.');
    }
  }

  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api<ReserveAvailabilityRule>('/api/reserve/availability-rules', {
        method: 'POST',
        body: JSON.stringify({
          ...ruleForm,
          intervalMinutes: Number(ruleForm.intervalMinutes || 30),
          defaultDurationMinutes: Number(ruleForm.defaultDurationMinutes || 120),
          minPartySize: Number(ruleForm.minPartySize || 1),
          maxPartySize: Number(ruleForm.maxPartySize || 1),
          capacity: Number(ruleForm.capacity || 1)
        })
      });
      setRuleForm(defaultRuleForm(ruleForm.venue));
      setSuccess('rule', 'Availability rule saved.');
      await load();
    } catch (error) {
      setError('rule', error, 'Could not save availability rule.');
    }
  }

  async function saveBlackout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api<ReserveBlackout>('/api/reserve/blackouts', {
        method: 'POST',
        body: JSON.stringify(blackoutForm)
      });
      setBlackoutForm(defaultBlackoutForm(blackoutForm.venue));
      setSuccess('blackout', 'Blackout saved.');
      await load();
    } catch (error) {
      setError('blackout', error, 'Could not save blackout.');
    }
  }

  async function saveDrinkPackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api<ReserveDrinkPackage>('/api/reserve/drink-packages', {
        method: 'POST',
        body: JSON.stringify({
          venue: drinkPackageForm.venue,
          name: drinkPackageForm.name,
          description: drinkPackageForm.description,
          priceCents: Math.round(Number(drinkPackageForm.price || 0) * 100),
          sortOrder: Number(drinkPackageForm.sortOrder || 0),
          isActive: drinkPackageForm.isActive
        })
      });
      setDrinkPackageForm({ venue: drinkPackageForm.venue, name: '', description: '', price: '', sortOrder: '0', isActive: true });
      setSuccess('drinks', 'Drinks package saved.');
      await load();
    } catch (error) {
      setError('drinks', error, 'Could not save the drinks package.');
    }
  }

  async function toggleDrinkPackage(pkg: ReserveDrinkPackage) {
    try {
      await api<ReserveDrinkPackage>(`/api/reserve/drink-packages/${pkg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !pkg.isActive })
      });
      await load();
    } catch (error) {
      setError('drinks', error, 'Could not update the drinks package.');
    }
  }

  async function saveArea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (areaForm.id) {
        await api<ReserveArea>(`/api/reserve/areas/${areaForm.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: areaForm.name,
            sortOrder: Number(areaForm.sortOrder || 0),
            isActive: areaForm.isActive
          })
        });
      } else {
        await api<ReserveArea>('/api/reserve/areas', {
          method: 'POST',
          body: JSON.stringify({
            venue: areaForm.venue,
            name: areaForm.name,
            sortOrder: Number(areaForm.sortOrder || 0),
            isActive: areaForm.isActive
          })
        });
      }
      setAreaForm({ id: null, venue: areaForm.venue, name: '', sortOrder: '0', isActive: true });
      setSuccess('areas', 'Area saved.');
      await load();
    } catch (error) {
      setError('areas', error, 'Could not save the area.');
    }
  }

  async function toggleArea(area: ReserveArea) {
    try {
      await api<ReserveArea>(`/api/reserve/areas/${area.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !area.isActive })
      });
      await load();
    } catch (error) {
      setError('areas', error, 'Could not update the area.');
    }
  }

  async function redeemDrinksFor(reservationId: string) {
    try {
      await api(`/api/reserve/reservations/${reservationId}/redeem-drinks`, { method: 'POST' });
      setSuccess('reservation', 'Drinks updated.');
      await load();
    } catch (error) {
      setError('reservation', error, 'Could not update the drinks.');
    }
  }

  async function previewWidgetAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setWidgetAvailability(
        await api<ReservePublicAvailabilityResponse>('/api/reserve/public-widget/availability', {
          method: 'POST',
          body: JSON.stringify({
            venue: widgetSearch.venue,
            date: `${widgetSearch.date}T00:00:00`,
            partySize: Number(widgetSearch.partySize || 1),
            servicePeriod: widgetSearch.servicePeriod
          })
        })
      );
      setSuccess('widget-preview', 'Public availability preview refreshed.');
    } catch (error) {
      setError('widget-preview', error, 'Could not preview availability.');
    }
  }

  async function saveGoogleReserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const next = await api<GoogleReserveIntegrationSetting>(`/api/reserve/google-reserve-settings/${encodeURIComponent(integrationForm.venue)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          venue: integrationForm.venue,
          enabled: integrationForm.enabled,
          merchantId: integrationForm.merchantId || '',
          integrationStatus: integrationForm.integrationStatus,
          lastError: integrationForm.lastError || ''
        })
      });
      setIntegration(next);
      setIntegrationForm(next);
      setSuccess('google-reserve', 'Google Reserve setup state saved. Live feed submission is still disabled in this pass.');
    } catch (error) {
      setError('google-reserve', error, 'Could not save Google Reserve settings.');
    }
  }

  const publicWidgetUrl = useMemo(() => new URL('/widget', window.location.origin).toString(), []);

  return (
    <AppShell
      brand={<ProductLogo appId="reserve" size="md" showBrandMark={false} />}
      sidebar={<SidebarNav />}
      topBar={<TopBarWithContext user={user} onLogout={onLogout} />}
    >
      <div className="reserve-page">
        {(() => {
          const covers = dashboard?.totals.coversToday ?? 0;
          const bookings = dashboard?.totals.todayBookings ?? 0;
          const venueLabel = venueFilter === ALL_VENUES ? 'All venues' : venueFilter;
          return (
            <AlmaHomeBubble
              app="reserve"
              appName="Reserve"
              appIcon={<BookIcon />}
              eyebrow="Reserve command"
              description="Bookings, covers, guests, and the front-of-house plan for tonight. Live across every venue you can see."
              statusLabel={`${venueLabel}`}
              statusHint={
                loading
                  ? 'Loading reserve dashboard…'
                  : `${bookings} bookings · ${covers} covers booked today`
              }
              statusDot={covers > 60 ? 'forest' : covers > 0 ? 'amber' : 'slate'}
              actions={
                <>
                  <button
                    type="button"
                    className="alma-home-bubble-btn alma-home-bubble-btn--primary"
                    onClick={() => void load()}
                  >
                    Refresh →
                  </button>
                  <button
                    type="button"
                    className="alma-home-bubble-btn alma-home-bubble-btn--ghost"
                    onClick={() => document.getElementById('guests')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  >
                    Guest CRM
                  </button>
                </>
              }
            />
          );
        })()}

        {showDashboard && (() => {
          // Editorial Bookings · tonight header — only on the dashboard tab.
          const isToday = selectedDate === new Date().toISOString().slice(0, 10);
          const venueLabel = venueFilter === ALL_VENUES ? 'All venues' : venueFilter;
          const dateObj = new Date(`${selectedDate}T12:00:00`);
          const dateLabel = dateObj.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
          const allTodayReservations = dashboard?.todayReservations ?? [];
          const covers = dashboard?.totals.coversToday ?? 0;
          // Capacity at peak (8–9pm) — count covers booked in that window
          const peakCovers = allTodayReservations
            .filter((r) => {
              const hr = new Date(r.startsAt).getHours();
              return hr === 20 || hr === 19;
            })
            .reduce((sum, r) => sum + r.covers, 0);
          // Assume venue capacity ~96 (matches the design's reference number); use tables × 4 if real data is loaded
          const totalCapacity = 96;
          const peakPct = totalCapacity > 0 ? Math.round((peakCovers / totalCapacity) * 100) : 0;
          const bookedPct = totalCapacity > 0 ? Math.round((covers / totalCapacity) * 100) : 0;
          // Notes-to-action count — reservations with allergens, VIP markers, or occasions
          const notesToAction = allTodayReservations.filter((r) =>
            (r.specialRequests || '').toLowerCase().match(/allerg|gluten|nut|shellfish|vegan|vegetarian|dairy/) ||
            r.occasion
          ).length;
          const periodLabel = (() => {
            const h = new Date().getHours();
            if (h < 12) return 'BREAKFAST';
            if (h < 17) return 'LUNCH';
            return 'DINNER';
          })();
          return (
            <>
              <div className="alma-reserve-header">
                <div className="alma-reserve-header-titles">
                  <span className="alma-roster-eyebrow">Reserve · {venueLabel}</span>
                  <div className="alma-roster-title-row">
                    <span className="alma-roster-title is-italic">{isToday ? 'Tonight' : 'Bookings'}</span>
                    <span className="alma-roster-title alma-reserve-title-sub">{dateLabel} · {periodLabel.toLowerCase()} service</span>
                    <div className="alma-roster-weeknav">
                      <button
                        type="button"
                        className="alma-roster-weeknav-btn"
                        aria-label="Previous day"
                        onClick={() => {
                          const d = new Date(`${selectedDate}T12:00:00`);
                          d.setDate(d.getDate() - 1);
                          setSelectedDate(d.toISOString().slice(0, 10));
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                          <polyline points="15 6 9 12 15 18" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="alma-roster-weeknav-btn"
                        aria-label="Next day"
                        onClick={() => {
                          const d = new Date(`${selectedDate}T12:00:00`);
                          d.setDate(d.getDate() + 1);
                          setSelectedDate(d.toISOString().slice(0, 10));
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                          <polyline points="9 6 15 12 9 18" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="alma-roster-weeknav-btn alma-roster-weeknav-btn--text"
                        onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}
                      >
                        Today
                      </button>
                    </div>
                  </div>
                  <div className="alma-reserve-summary">
                    {(dashboard?.totals.todayBookings ?? 0)} bookings · {covers} covers booked
                  </div>
                </div>
                <div className="alma-reserve-header-actions">
                  <Select
                    aria-label="Venue"
                    value={venueFilter}
                    onChange={(event) => setVenueFilter(event.currentTarget.value)}
                    options={venueOptions}
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>Refresh</Button>
                  <Button type="button" size="sm" variant="secondary"
                    onClick={() => document.getElementById('guests')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                    Guest CRM
                  </Button>
                </div>
              </div>

              {/* Editorial KPI strip — service-themed with capacity bars */}
              <div className="alma-reserve-kpis">
                <div className="alma-bigstat alma-bigstat--bar">
                  <div className="alma-bigstat-eyebrow">Covers booked</div>
                  <div className="alma-bigstat-value">{covers}</div>
                  <div className="alma-bigstat-sub">of ~{totalCapacity} total</div>
                  <div className="alma-capbar">
                    <div className="alma-capbar-fill" style={{ width: `${Math.min(100, bookedPct)}%`, background: '#1F2A1E' }} />
                  </div>
                </div>
                <div className="alma-bigstat alma-bigstat--bar">
                  <div className="alma-bigstat-eyebrow">Peak window · 7–9pm</div>
                  <div className="alma-bigstat-value">{peakPct}%</div>
                  <div className="alma-bigstat-sub">{peakCovers} covers in window</div>
                  <div className="alma-capbar">
                    <div className="alma-capbar-fill" style={{ width: `${Math.min(100, peakPct)}%`, background: peakPct > 80 ? '#B27935' : '#4F6B47' }} />
                  </div>
                </div>
                <BigStat
                  eyebrow="Notes to action"
                  value={String(notesToAction)}
                  sub={notesToAction > 0 ? 'VIP, allergens, occasions' : 'All quiet'}
                />
                <BigStat
                  eyebrow="No-shows today"
                  value={String(dashboard?.totals.noShowsToday ?? 0)}
                  sub={`${dashboard?.totals.cancellationsToday ?? 0} cancellations`}
                  sparkColor="#A0463A"
                />
                <BigStat
                  eyebrow="Repeat guests · 30d"
                  value={String(dashboard?.totals.repeatGuests30Days ?? 0)}
                  sub={`${dashboard?.totals.newGuests30Days ?? 0} new this month`}
                />
              </div>
            </>
          );
        })()}

        {feedback.target === 'page' && feedback.message ? <p className="error-text">{feedback.message}</p> : null}

        {showSettings ? (
          <nav className="reserve-settings-tabs" aria-label="Reserve settings">
            {SETTINGS_TABS.map((tab) => (
              <a
                key={tab.hash}
                href={tab.hash}
                className={settingsTab === tab.key ? 'active' : ''}
                onClick={() => setActiveHash(tab.hash)}
              >
                {tab.label}
              </a>
            ))}
          </nav>
        ) : null}

        <div className={`reserve-layout${showSettings ? ' is-settings' : ''}`}>
          {(!showSettings || showAvailability || showFloorPlan) ? (
          <section className="reserve-main">
            {showService ? (
            <section id="service">
              <Card
                title="Service"
                subtitle={`Live floor${scopedVenueParam ? ` · ${scopedVenueParam}` : ''} — seat guests, advance courses, request the bill, clear tables.`}
              >
                {loading && !dashboard ? <Spinner label="Loading service floor…" /> : null}
                <ServiceBoard
                  tables={tables.filter((t) => t.isActive && (venueFilter === ALL_VENUES || t.venue === venueFilter))}
                  reservations={dashboard?.todayReservations ?? []}
                  onAction={serviceAction}
                  busy={serviceBusy}
                  calls={calls}
                  onCall={sendTableCall}
                  onUpdateCall={updateTableCall}
                  squareOrders={squareOrders}
                />
              </Card>
            </section>
            ) : null}

            {showDashboard ? (
            <section id="dashboard">
              <Card title="Today and upcoming" subtitle={scopedVenueParam ?? 'All venues'}>
              {loading ? <Spinner label="Loading reserve dashboard..." /> : null}
              {!loading && dashboard ? (
                <div className="reserve-section-grid">
                  <div className="reserve-stack">
                    {(() => {
                      // Split into earlier (departed/seated/completed) vs upcoming (confirmed/pending)
                      const todays = dashboard.todayReservations;
                      const earlier = todays.filter((r) => r.status === 'COMPLETED' || r.status === 'SEATED' || r.status === 'CANCELLED' || r.status === 'NO_SHOW');
                      const upcoming = todays.filter((r) => r.status === 'CONFIRMED' || r.status === 'PENDING');
                      const isViewingToday = selectedDate === new Date().toISOString().slice(0, 10);
                      const nowLabel = new Date().toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase().replace(' ', '');
                      // Find next upcoming and show minutes-to-next
                      const nextUpcoming = upcoming.length > 0 ? upcoming[0] : null;
                      const minsToNext = nextUpcoming
                        ? Math.max(0, Math.round((new Date(nextUpcoming.startsAt).getTime() - Date.now()) / 60000))
                        : null;
                      if (todays.length === 0) {
                        return (
                          <EmptyState
                            title="No bookings for this day"
                            description="Use the booking form to add a reservation or preview online slots."
                          />
                        );
                      }
                      return (
                        <div className="alma-service-feed">
                          {earlier.length > 0 ? (
                            <>
                              <div className="alma-service-marker">
                                <span className="alma-roster-eyebrow">Earlier</span>
                                <span className="alma-service-marker-hint">In service or departed</span>
                                <span className="alma-service-marker-line" />
                              </div>
                              <div className="alma-service-rows">
                                {earlier.map((reservation) => (
                                  <BookingRow
                                    key={reservation.id}
                                    reservation={reservation}
                                    feedback={feedback}
                                    onStatus={(status) => void updateReservationStatus(reservation, status)}
                                    onRedeemDrinks={() => void redeemDrinksFor(reservation.id)}
                                    onChargeNoShow={() => void chargeNoShow(reservation)}
                                  />
                                ))}
                              </div>
                            </>
                          ) : null}

                          {isViewingToday && upcoming.length > 0 && earlier.length > 0 ? (
                            <div className="alma-service-nowline">
                              <span className="alma-service-nowline-dot" />
                              <span className="alma-service-nowline-label">Now · {nowLabel}</span>
                              {minsToNext !== null ? (
                                <span className="alma-service-nowline-hint">
                                  Next seating in {minsToNext < 1 ? 'under a minute' : `${minsToNext} min`}
                                </span>
                              ) : null}
                            </div>
                          ) : null}

                          <div className="alma-service-marker">
                            <span className="alma-roster-eyebrow">Coming up</span>
                            <span className="alma-service-marker-hint">
                              {upcoming.length} {upcoming.length === 1 ? 'booking' : 'bookings'} to host
                            </span>
                            <span className="alma-service-marker-line" />
                          </div>
                          <div className="alma-service-rows">
                            {upcoming.map((reservation) => (
                              <BookingRow
                                key={reservation.id}
                                reservation={reservation}
                                feedback={feedback}
                                onStatus={(status) => void updateReservationStatus(reservation, status)}
                                onRedeemDrinks={() => void redeemDrinksFor(reservation.id)}
                                onChargeNoShow={() => void chargeNoShow(reservation)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="reserve-stack">
                    <div className="reserve-section-heading">
                      <strong>Upcoming bookings</strong>
                      <Badge tone="neutral">{dashboard.upcomingReservations.length}</Badge>
                    </div>
                    {dashboard.upcomingReservations.slice(0, 6).map((reservation) => (
                      <div key={reservation.id} className="reserve-summary-card">
                        <strong>{reservation.guestName || fullName(reservation.guest)}</strong>
                        <span>{reservation.venue} · {formatDateTime(reservation.startsAt)} · {reservation.covers} guests</span>
                      </div>
                    ))}
                    <div className="reserve-section-heading">
                      <strong>Recent no-shows</strong>
                      <Badge tone="warning">{dashboard.recentNoShows.length}</Badge>
                    </div>
                    {dashboard.recentNoShows.length === 0 ? (
                      <p className="subtle">No recent no-shows in this venue scope.</p>
                    ) : (
                      dashboard.recentNoShows.map((reservation) => (
                        <div key={reservation.id} className="reserve-summary-card">
                          <strong>{reservation.guestName || fullName(reservation.guest)}</strong>
                          <span>{reservation.venue} · {formatDateTime(reservation.startsAt)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
              </Card>
            </section>
            ) : null}

            {showGuests ? (
            <section id="guests">
              <Card title="Guest CRM" subtitle="Searchable venue guests, consent, and reservation history">
              <div className="reserve-toolbar">
                <Input
                  label="Search guests"
                  value={guestSearch}
                  onChange={(event) => setGuestSearch(event.currentTarget.value)}
                  placeholder="Name, email, or phone"
                />
                <Button type="button" variant="secondary" onClick={() => void load()}>Search</Button>
              </div>
              <div className="reserve-section-grid">
                <div className="reserve-stack">
                  {guests.length === 0 ? (
                    <EmptyState title="No guests yet" description="Bookings and staff-created reservations will start building the guest book." />
                  ) : (
                    guests.map((guest) => (
                      <button
                        key={guest.id}
                        type="button"
                        className={`reserve-guest-row ${selectedGuestId === guest.id ? 'active' : ''}`}
                        onClick={() => setSelectedGuestId(guest.id)}
                      >
                        <div>
                          <strong>{fullName(guest)}</strong>
                          <span>{guest.email || guest.phone || 'No contact'} · {guest.venue || 'Cross-venue guest'} · {guest.totalVisits} visits</span>
                        </div>
                        <div className="reserve-note-list">
                          {guest.marketingOptIn ? <Badge tone="positive">Opted in</Badge> : <Badge tone="neutral">No consent</Badge>}
                          {guest.tagAssignments?.slice(0, 2).map((assignment) => (
                            <Badge key={assignment.id} tone="neutral">{assignment.tag.name}</Badge>
                          ))}
                        </div>
                      </button>
                    ))
                  )}
                </div>
                <div className="reserve-stack">
                  {guestDetail ? (
                    <>
                      <Card title={fullName(guestDetail.guest)} subtitle={guestDetail.guest.venue || 'Venue not set'}>
                        <div className="reserve-summary-list">
                          <span>{guestDetail.guest.email || 'No email'}</span>
                          <span>{guestDetail.guest.phone || 'No phone'}</span>
                          <span>{guestDetail.guest.totalVisits} visits · ${(
                            guestDetail.guest.totalSpendCents / 100
                          ).toFixed(2)} tracked spend</span>
                          {guestDetail.guest.notes ? <span>{guestDetail.guest.notes}</span> : null}
                        </div>
                      </Card>
                      <Card title="Reservation history" subtitle={`${guestDetail.reservations.length} bookings`}>
                        {guestDetail.reservations.length === 0 ? (
                          <EmptyState title="No bookings yet" description="This guest will build history after the first reservation is completed." />
                        ) : (
                          <div className="reserve-timeline">
                            {guestDetail.reservations.slice(0, 8).map((reservation) => (
                              <div key={reservation.id} className="reserve-summary-card">
                                <strong>{reservation.status.replace('_', ' ')}</strong>
                                <span>{formatDateTime(reservation.startsAt)} · {reservation.covers} guests · {reservation.venue}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </Card>
                      <Card title="Guest timeline" subtitle="Bookings, tags, campaign simulations, content links, and gift card matches">
                        {guestDetail.timeline?.timeline.length ? (
                          <div className="reserve-timeline">
                            {guestDetail.timeline.timeline.slice(0, 12).map((item) => (
                              <div key={item.id} className="reserve-summary-card">
                                <strong>{item.title}</strong>
                                <span>{formatDateTime(item.at)} · {item.source.replace('_', ' ')} · {item.venue || 'No venue'}</span>
                                <span>{item.description}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <EmptyState title="No timeline yet" description="Reservations, tags, campaign simulations, and gift card matches will appear here." />
                        )}
                      </Card>
                    </>
                  ) : (
                    <EmptyState title="Select a guest" description="See tags, consent, and booking history in one place." />
                  )}
                </div>
              </div>
              </Card>
            </section>
            ) : null}

            {showWaitlist ? (
            <section id="waitlist">
              <WaitlistSection defaultVenue={venueFilter === ALL_VENUES ? KNOWN_VENUES[0]! : venueFilter} venueOptions={venueOptions} />
            </section>
            ) : null}

            {showFloorPlan ? (
            <section id="floor-plan">
              <FloorPlanSection
                venue={venueFilter === ALL_VENUES ? KNOWN_VENUES[0]! : venueFilter}
                tables={tables.filter((t) => t.isActive && (venueFilter === ALL_VENUES || t.venue === venueFilter))}
                reservations={dashboard?.todayReservations ?? []}
                onAssignTable={async (reservationId, tableId) => {
                  try {
                    await api(`/api/reserve/reservations/${reservationId}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ tableId: tableId || null })
                    });
                    setSuccess('reservation', tableId ? 'Reservation assigned to table.' : 'Reservation unassigned.');
                    void load();
                  } catch (error) {
                    setError('reservation', error, 'Could not assign reservation.');
                  }
                }}
                onSaveLayout={async (updates) => {
                  try {
                    await api('/api/reserve/tables/layout', {
                      method: 'PATCH',
                      body: JSON.stringify({
                        venue: venueFilter === ALL_VENUES ? KNOWN_VENUES[0]! : venueFilter,
                        tables: updates
                      })
                    });
                    setSuccess('reservation', 'Floor plan saved.');
                    void load();
                  } catch (error) {
                    setError('reservation', error, 'Could not save the floor plan.');
                  }
                }}
                onAutoAssign={async () => {
                  // Greedy: seat the largest parties first into the smallest free
                  // table that fits (min/max covers), so big tables aren't wasted.
                  const venueTables = tables.filter(
                    (t) => t.isActive && (venueFilter === ALL_VENUES || t.venue === venueFilter)
                  );
                  const todays = dashboard?.todayReservations ?? [];
                  const taken = new Set(todays.filter((r) => r.tableId).map((r) => r.tableId));
                  const free = venueTables
                    .filter((t) => !taken.has(t.id))
                    .sort((a, b) => a.maxCovers - b.maxCovers);
                  const unassigned = todays
                    .filter((r) => !r.tableId && r.status !== 'CANCELLED' && r.status !== 'NO_SHOW')
                    .sort((a, b) => b.covers - a.covers);
                  const assignments: Array<{ reservationId: string; tableId: string }> = [];
                  for (const r of unassigned) {
                    const idx = free.findIndex((t) => r.covers <= t.maxCovers && r.covers >= t.minCovers);
                    if (idx >= 0) {
                      assignments.push({ reservationId: r.id, tableId: free[idx]!.id });
                      free.splice(idx, 1);
                    }
                  }
                  if (assignments.length === 0) {
                    setError(
                      'reservation',
                      new Error('No free tables match the unassigned bookings.'),
                      'No free tables match the unassigned bookings.'
                    );
                    return;
                  }
                  try {
                    await Promise.all(
                      assignments.map((a) =>
                        api(`/api/reserve/reservations/${a.reservationId}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ tableId: a.tableId })
                        })
                      )
                    );
                    const leftover = unassigned.length - assignments.length;
                    setSuccess(
                      'reservation',
                      `Assigned ${assignments.length} booking${assignments.length === 1 ? '' : 's'}${leftover > 0 ? ` · ${leftover} still need a table` : ''}.`
                    );
                    void load();
                  } catch (error) {
                    setError('reservation', error, 'Could not auto-assign tables.');
                  }
                }}
              />
            </section>
            ) : null}

            {showAvailability ? (
            <section id="availability">
              <Card title="Availability rules and blackouts" subtitle="The first safe online-booking layer">
              <div className="reserve-section-grid">
                <div className="reserve-stack">
                  <Card title="Availability rules" subtitle="Capacity-based slots, venue scoped">
                    <form className="reserve-form" onSubmit={(event) => void saveRule(event)}>
                      <div className="form-grid two">
                        <Select label="Venue" value={ruleForm.venue} onChange={(event) => { const el = event.currentTarget; setRuleForm((current) => ({ ...current, venue: el.value })); }} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                        <Input label="Rule name" required value={ruleForm.name} onChange={(event) => { const el = event.currentTarget; setRuleForm((current) => ({ ...current, name: el.value })); }} />
                        <Select label="Service" value={ruleForm.servicePeriod} onChange={(event) => { const el = event.currentTarget; setRuleForm((current) => ({ ...current, servicePeriod: el.value as ReserveServicePeriod })); }} options={SERVICE_PERIODS.map((value) => ({ label: value, value }))} />
                        <Input label="Capacity" type="number" min="1" value={ruleForm.capacity} onChange={(event) => { const el = event.currentTarget; setRuleForm((current) => ({ ...current, capacity: el.value })); }} />
                        <Input label="Start" type="time" value={ruleForm.startTime} onChange={(event) => { const el = event.currentTarget; setRuleForm((current) => ({ ...current, startTime: el.value })); }} />
                        <Input label="End" type="time" value={ruleForm.endTime} onChange={(event) => { const el = event.currentTarget; setRuleForm((current) => ({ ...current, endTime: el.value })); }} />
                        <Input label="Interval mins" type="number" min="15" value={ruleForm.intervalMinutes} onChange={(event) => { const el = event.currentTarget; setRuleForm((current) => ({ ...current, intervalMinutes: el.value })); }} />
                        <Input label="Duration mins" type="number" min="30" value={ruleForm.defaultDurationMinutes} onChange={(event) => { const el = event.currentTarget; setRuleForm((current) => ({ ...current, defaultDurationMinutes: el.value })); }} />
                        <Input label="Min party" type="number" min="1" value={ruleForm.minPartySize} onChange={(event) => { const el = event.currentTarget; setRuleForm((current) => ({ ...current, minPartySize: el.value })); }} />
                        <Input label="Max party" type="number" min="1" value={ruleForm.maxPartySize} onChange={(event) => { const el = event.currentTarget; setRuleForm((current) => ({ ...current, maxPartySize: el.value })); }} />
                      </div>
                      <div className="reserve-day-picker">
                        {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                          <label key={day} className="reserve-inline-check">
                            <input
                              type="checkbox"
                              checked={ruleForm.daysOfWeek.includes(day)}
                              onChange={(event) => {
                                const checked = event.currentTarget.checked;
                                setRuleForm((current) => ({
                                  ...current,
                                  daysOfWeek: checked
                                    ? Array.from(new Set([...current.daysOfWeek, day])).sort((a, b) => a - b)
                                    : current.daysOfWeek.filter((value) => value !== day)
                                }));
                              }}
                            />
                            <span>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]}</span>
                          </label>
                        ))}
                      </div>
                      <div className="reserve-day-picker">
                        <label className="reserve-inline-check">
                          <input
                            type="checkbox"
                            checked={ruleForm.onlineEnabled}
                            onChange={(event) => {
                              const checked = event.currentTarget.checked;
                              setRuleForm((current) => ({ ...current, onlineEnabled: checked }));
                            }}
                          />
                          <span>Online booking enabled</span>
                        </label>
                        <label className="reserve-inline-check">
                          <input
                            type="checkbox"
                            checked={ruleForm.googleReserveEnabled}
                            onChange={(event) => {
                              const checked = event.currentTarget.checked;
                              setRuleForm((current) => ({ ...current, googleReserveEnabled: checked }));
                            }}
                          />
                          <span>Google Reserve ready when integration is configured</span>
                        </label>
                      </div>
                      <div className="toolbar-right">
                        <ActionFeedback message={feedback.target === 'rule' ? feedback.message : null} tone={feedback.tone} />
                        <Button type="submit">Save rule</Button>
                      </div>
                    </form>
                  </Card>

                  <Card title="Active rules" subtitle={`${rules.length} rules in scope`}>
                    {rules.length === 0 ? (
                      <EmptyState title="No rules yet" description="Add a rule before turning on the public widget." />
                    ) : (
                      <div className="reserve-timeline">
                        {rules.map((rule) => (
                          <div key={rule.id} className="reserve-summary-card">
                            <strong>{rule.name}</strong>
                            <span>{rule.venue} · {rule.startTime}-{rule.endTime} · cap {rule.capacity} · {rule.daysOfWeek.join(', ')}</span>
                            <div className="reserve-note-list">
                              {rule.onlineEnabled ? <Badge tone="positive">Online</Badge> : <Badge tone="neutral">Internal only</Badge>}
                              {rule.googleReserveEnabled ? <Badge tone="warning">Google-ready</Badge> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>

                <div className="reserve-stack">
                  <Card title="Blackouts" subtitle="Protect private events and closures">
                    <form className="reserve-form" onSubmit={(event) => void saveBlackout(event)}>
                      <div className="form-grid two">
                        <Select label="Venue" value={blackoutForm.venue} onChange={(event) => { const el = event.currentTarget; setBlackoutForm((current) => ({ ...current, venue: el.value })); }} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                        <Input label="Name" required value={blackoutForm.name} onChange={(event) => { const el = event.currentTarget; setBlackoutForm((current) => ({ ...current, name: el.value })); }} />
                        <Input label="Start" type="datetime-local" value={blackoutForm.startAt} onChange={(event) => { const el = event.currentTarget; setBlackoutForm((current) => ({ ...current, startAt: el.value })); }} />
                        <Input label="End" type="datetime-local" value={blackoutForm.endAt} onChange={(event) => { const el = event.currentTarget; setBlackoutForm((current) => ({ ...current, endAt: el.value })); }} />
                      </div>
                      <Textarea label="Reason" rows={3} value={blackoutForm.reason} onChange={(event) => { const el = event.currentTarget; setBlackoutForm((current) => ({ ...current, reason: el.value })); }} />
                      <div className="toolbar-right">
                        <ActionFeedback message={feedback.target === 'blackout' ? feedback.message : null} tone={feedback.tone} />
                        <Button type="submit" variant="secondary">Save blackout</Button>
                      </div>
                    </form>
                  </Card>

                  <Card title="Blocked periods" subtitle={`${blackouts.length} blackout windows`}>
                    {blackouts.length === 0 ? (
                      <EmptyState title="No blackout windows" description="Add blackout periods for full-buyouts, closures, or service pauses." />
                    ) : (
                      <div className="reserve-timeline">
                        {blackouts.map((blackout) => (
                          <div key={blackout.id} className="reserve-summary-card">
                            <strong>{blackout.name}</strong>
                            <span>{blackout.venue} · {formatDateTime(blackout.startAt)} to {formatDateTime(blackout.endAt)}</span>
                            {blackout.reason ? <span>{blackout.reason}</span> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>
              </div>
              </Card>
            </section>
            ) : null}
          </section>
          ) : null}

          {(!showSettings || showTables || showDrinks || showAreas) ? (
          <aside className="reserve-side">
            {!showSettings ? (
            <Card title="Quick create booking" subtitle="Manager-entered reservation with guest consent capture">
              <form className="reserve-form" onSubmit={(event) => void saveReservation(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={reservationForm.venue} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, venue: el.value, area: '', tableId: '' })); }} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                  <Select label="Service" value={reservationForm.servicePeriod} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, servicePeriod: el.value as ReserveServicePeriod })); }} options={SERVICE_PERIODS.map((value) => ({ label: value, value }))} />
                  <Input label="Date" type="date" value={reservationForm.serviceDate} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, serviceDate: el.value })); }} />
                  <Input label="Time" type="time" value={reservationForm.time} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, time: el.value })); }} />
                  <Input label="Guests" type="number" min="1" value={reservationForm.covers} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, covers: el.value })); }} />
                  <Input label="Duration mins" type="number" min="30" value={reservationForm.durationMinutes} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, durationMinutes: el.value })); }} />
                  {areasForVenue(reservationForm.venue).length > 0 ? (
                    <Select label="Area" value={reservationForm.area} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, area: el.value, tableId: '' })); }} options={[{ label: 'Any area', value: '' }, ...areasForVenue(reservationForm.venue).map((value) => ({ label: value, value }))]} />
                  ) : null}
                  <Select label="Table" value={reservationForm.tableId} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, tableId: el.value })); }} options={tableOptions} />
                  <Select label="Rule" value={reservationForm.availabilityRuleId} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, availabilityRuleId: el.value })); }} options={ruleOptions} />
                  <Input label="First name" required value={reservationForm.firstName} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, firstName: el.value })); }} />
                  <Input label="Last name" required value={reservationForm.lastName} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, lastName: el.value })); }} />
                  <Input label="Email" type="email" value={reservationForm.email} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, email: el.value })); }} />
                  <Input label="Phone" value={reservationForm.phone} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, phone: el.value })); }} />
                  <Select label="Status" value={reservationForm.status} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, status: el.value as ReserveReservationStatus })); }} options={RESERVATION_STATUSES.map((value) => ({ label: value.replace('_', ' '), value }))} />
                  <Input label="Occasion" value={reservationForm.occasion} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, occasion: el.value })); }} />
                </div>
                <Textarea label="Special requests" rows={2} value={reservationForm.specialRequests} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, specialRequests: el.value })); }} />
                <Textarea label="Internal notes" rows={2} value={reservationForm.internalNotes} onChange={(event) => { const el = event.currentTarget; setReservationForm((current) => ({ ...current, internalNotes: el.value })); }} />
                <label className="reserve-inline-check">
                  <input
                    type="checkbox"
                    checked={reservationForm.marketingOptIn}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setReservationForm((current) => ({ ...current, marketingOptIn: checked }));
                    }}
                  />
                  <span>Guest opted into venue marketing updates.</span>
                </label>
                {(() => {
                  const venuePackages = drinkPackages
                    .filter((p) => p.venue === reservationForm.venue && p.isActive)
                    .map((p) => ({ id: p.id, name: p.name, description: p.description, priceCents: p.priceCents }));
                  if (!venuePackages.length) return null;
                  if (bookingDrinksIntentId) {
                    return (
                      <div className="drinks-paid-note">
                        ✓ Drinks pre-paid for this booking.{' '}
                        <button type="button" className="drinks-pay__back" onClick={() => setBookingDrinksIntentId(null)}>Remove</button>
                      </div>
                    );
                  }
                  return (
                    <DrinksPaymentPanel
                      venue={reservationForm.venue}
                      packages={venuePackages}
                      guestEmail={reservationForm.email}
                      title="Pre-pay drinks (optional)"
                      subtitle="Take the guest's card to add drinks to this booking, redeemed on arrival."
                      onPaid={(intentId) => setBookingDrinksIntentId(intentId)}
                    />
                  );
                })()}
                <div className="toolbar-right">
                  <ActionFeedback message={feedback.target === 'reservation' ? feedback.message : null} tone={feedback.tone} />
                  <Button type="submit">Save booking</Button>
                </div>
              </form>

              {formGuestHistory ? (
                <div className="reserve-guest-match-panel">
                  <div className="reserve-guest-match-head">
                    <div>
                      <strong>Returning guest</strong>
                      <small>{formGuestHistory.matchedGuest.firstName} {formGuestHistory.matchedGuest.lastName} · {formGuestHistory.matchedGuest.email}</small>
                    </div>
                    <Badge tone="positive">{formGuestHistory.matchedGuest.totalVisits} visit{formGuestHistory.matchedGuest.totalVisits === 1 ? '' : 's'}</Badge>
                  </div>
                  <div className="reserve-guest-match-stats">
                    <div>
                      <span>Total spend</span>
                      <strong>{formGuestHistory.matchedGuest.totalSpendCents > 0
                        ? `$${(formGuestHistory.matchedGuest.totalSpendCents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                        : '—'}</strong>
                    </div>
                    <div>
                      <span>Last visit</span>
                      <strong>{formGuestHistory.matchedGuest.lastVisitAt
                        ? new Date(formGuestHistory.matchedGuest.lastVisitAt).toLocaleDateString()
                        : '—'}</strong>
                    </div>
                    <div>
                      <span>No-shows</span>
                      <strong className={formGuestHistory.matchedGuest.noShowCount > 0 ? 'is-warning' : ''}>
                        {formGuestHistory.matchedGuest.noShowCount}
                      </strong>
                    </div>
                  </div>
                  {formGuestHistory.recentReservations.length > 0 ? (
                    <div className="reserve-guest-match-list">
                      <small>Last 3 visits</small>
                      {formGuestHistory.recentReservations.map((r) => (
                        <div key={r.id} className="reserve-guest-match-row">
                          <span>{new Date(r.startsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                          <span>{r.covers} guest{r.covers === 1 ? '' : 's'} · {r.servicePeriod.toLowerCase()}</span>
                          <Badge tone={r.status === 'COMPLETED' ? 'positive' : r.status === 'NO_SHOW' ? 'danger' : r.status === 'CANCELLED' ? 'muted' : 'info'}>
                            {r.status.replace('_', ' ').toLowerCase()}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {formGuestHistory.matchedGuest.allergyNotes || formGuestHistory.matchedGuest.visitNotes ? (
                    <div className="reserve-guest-match-notes">
                      {formGuestHistory.matchedGuest.allergyNotes ? (
                        <p><strong>Allergies:</strong> {formGuestHistory.matchedGuest.allergyNotes}</p>
                      ) : null}
                      {formGuestHistory.matchedGuest.visitNotes ? (
                        <p><strong>Notes:</strong> {formGuestHistory.matchedGuest.visitNotes}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Card>
            ) : null}

            {showTables ? (
            <Card title="Tables" subtitle="Lightweight table map foundation">
              <form className="reserve-form" onSubmit={(event) => void saveTable(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={tableForm.venue} onChange={(event) => { const el = event.currentTarget; setTableForm((current) => ({ ...current, venue: el.value })); }} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                  {(() => {
                    const venueAreas = areasForVenue(tableForm.venue || venueFilter);
                    // No configured areas for this venue → keep the original free-text
                    // input so the field never becomes unusable.
                    if (venueAreas.length === 0) {
                      return <Input label="Area" value={tableForm.area} onChange={(event) => { const el = event.currentTarget; setTableForm((current) => ({ ...current, area: el.value })); }} />;
                    }
                    // Include the current value as an option if it's not in the list,
                    // so editing an existing table never silently loses its area.
                    const areaOptions = (tableForm.area && !venueAreas.includes(tableForm.area)
                      ? [tableForm.area, ...venueAreas]
                      : venueAreas
                    ).map((value) => ({ label: value, value }));
                    return <Select label="Area" value={tableForm.area} onChange={(event) => { const el = event.currentTarget; setTableForm((current) => ({ ...current, area: el.value })); }} options={areaOptions} />;
                  })()}
                  <Input label="Label" required value={tableForm.label} onChange={(event) => { const el = event.currentTarget; setTableForm((current) => ({ ...current, label: el.value })); }} />
                  <Input label="Min covers" type="number" min="1" value={tableForm.minCovers} onChange={(event) => { const el = event.currentTarget; setTableForm((current) => ({ ...current, minCovers: el.value })); }} />
                  <Input label="Max covers" type="number" min="1" value={tableForm.maxCovers} onChange={(event) => { const el = event.currentTarget; setTableForm((current) => ({ ...current, maxCovers: el.value })); }} />
                  <Input label="Sort" type="number" value={tableForm.sortOrder} onChange={(event) => { const el = event.currentTarget; setTableForm((current) => ({ ...current, sortOrder: el.value })); }} />
                </div>
                <div className="toolbar-right">
                  <ActionFeedback message={feedback.target === 'table' ? feedback.message : null} tone={feedback.tone} />
                  <Button type="submit" variant="secondary">Save table</Button>
                </div>
              </form>
              <div className="reserve-table-list">
                {tables.map((table) => (
                  <span key={table.id}>{table.venue} · {table.label} · {table.area} · {table.minCovers}-{table.maxCovers}</span>
                ))}
              </div>
            </Card>
            ) : null}

            {showAreas ? (
            <section id="areas">
              <Card title="Areas" subtitle="Bookable areas per venue (e.g. Inside, Outside, Bar). Drive the booking area picker, the table editor, and the floor-plan filter.">
                <div className="reserve-section-grid">
                  <div className="reserve-stack">
                    <Card title={areaForm.id ? 'Edit area' : 'Add an area'} subtitle="Per venue · lower sort shows first">
                      <form className="reserve-form" onSubmit={(event) => void saveArea(event)}>
                        <div className="form-grid two">
                          {venueFilter === ALL_VENUES ? (
                            <Select
                              label="Venue"
                              value={areaForm.venue}
                              onChange={(event) => { const v = event.currentTarget.value; setAreaForm((c) => ({ ...c, venue: v })); }}
                              options={KNOWN_VENUES.map((value) => ({ label: value, value }))}
                            />
                          ) : (
                            <Input label="Venue" value={areaForm.venue} disabled readOnly />
                          )}
                          <Input
                            label="Name"
                            required
                            value={areaForm.name}
                            onChange={(event) => { const v = event.currentTarget.value; setAreaForm((c) => ({ ...c, name: v })); }}
                            placeholder="e.g. Outside"
                          />
                          <Input
                            label="Sort"
                            type="number"
                            value={areaForm.sortOrder}
                            onChange={(event) => { const v = event.currentTarget.value; setAreaForm((c) => ({ ...c, sortOrder: v })); }}
                          />
                        </div>
                        <label className="reserve-inline-check">
                          <input
                            type="checkbox"
                            checked={areaForm.isActive}
                            onChange={(event) => { const v = event.currentTarget.checked; setAreaForm((c) => ({ ...c, isActive: v })); }}
                          />
                          <span>Available for bookings</span>
                        </label>
                        <div className="toolbar-right">
                          <ActionFeedback message={feedback.target === 'areas' ? feedback.message : null} tone={feedback.tone} />
                          {areaForm.id ? (
                            <Button type="button" size="sm" variant="ghost" onClick={() => setAreaForm({ id: null, venue: areaForm.venue, name: '', sortOrder: '0', isActive: true })}>
                              Cancel
                            </Button>
                          ) : null}
                          <Button type="submit">{areaForm.id ? 'Update area' : 'Save area'}</Button>
                        </div>
                      </form>
                    </Card>
                  </div>
                  <div className="reserve-stack">
                    <Card title="Areas" subtitle={`${areas.length} configured`}>
                      {areas.length === 0 ? (
                        <EmptyState title="No areas yet" description="Add an area above — it'll appear in the booking form, the table editor, and the floor-plan filter for that venue." />
                      ) : (
                        <div className="reserve-timeline">
                          {[...areas]
                            .sort((a, b) => a.venue.localeCompare(b.venue) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
                            .map((area) => (
                              <div key={area.id} className="reserve-summary-card">
                                <strong>{area.name}</strong>
                                <span>{area.venue} · sort {area.sortOrder}</span>
                                <div className="reserve-note-list">
                                  {area.isActive ? <Badge tone="positive">Active</Badge> : <Badge tone="neutral">Hidden</Badge>}
                                  <Button type="button" size="sm" variant="ghost" onClick={() => setAreaForm({ id: area.id, venue: area.venue, name: area.name, sortOrder: String(area.sortOrder), isActive: area.isActive })}>
                                    Edit
                                  </Button>
                                  <Button type="button" size="sm" variant="ghost" onClick={() => void toggleArea(area)}>
                                    {area.isActive ? 'Hide' : 'Show'}
                                  </Button>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </Card>
                  </div>
                </div>
              </Card>
            </section>
            ) : null}

            {showDrinks ? (
            <section id="drinks">
              <Card title="Drinks packages" subtitle="Pre-paid drinks guests add at booking and redeem on arrival. Charged in full at booking.">
                <div className="reserve-section-grid">
                  <div className="reserve-stack">
                    <Card title="Add a package" subtitle="Per venue · price in dollars">
                      <form className="reserve-form" onSubmit={(event) => void saveDrinkPackage(event)}>
                        <div className="form-grid two">
                          <Select
                            label="Venue"
                            value={drinkPackageForm.venue}
                            onChange={(event) => { const v = event.currentTarget.value; setDrinkPackageForm((c) => ({ ...c, venue: v })); }}
                            options={KNOWN_VENUES.map((value) => ({ label: value, value }))}
                          />
                          <Input
                            label="Name"
                            required
                            value={drinkPackageForm.name}
                            onChange={(event) => { const v = event.currentTarget.value; setDrinkPackageForm((c) => ({ ...c, name: v })); }}
                            placeholder="e.g. Welcome Prosecco"
                          />
                          <Input
                            label="Price (AUD)"
                            type="number"
                            min="0"
                            step="0.01"
                            required
                            value={drinkPackageForm.price}
                            onChange={(event) => { const v = event.currentTarget.value; setDrinkPackageForm((c) => ({ ...c, price: v })); }}
                            placeholder="45.00"
                          />
                          <Input
                            label="Sort"
                            type="number"
                            value={drinkPackageForm.sortOrder}
                            onChange={(event) => { const v = event.currentTarget.value; setDrinkPackageForm((c) => ({ ...c, sortOrder: v })); }}
                          />
                          <Input
                            label="Description"
                            value={drinkPackageForm.description}
                            onChange={(event) => { const v = event.currentTarget.value; setDrinkPackageForm((c) => ({ ...c, description: v })); }}
                            placeholder="A bottle of NV Prosecco on the table"
                          />
                        </div>
                        <label className="reserve-inline-check">
                          <input
                            type="checkbox"
                            checked={drinkPackageForm.isActive}
                            onChange={(event) => { const v = event.currentTarget.checked; setDrinkPackageForm((c) => ({ ...c, isActive: v })); }}
                          />
                          <span>Available to guests</span>
                        </label>
                        <div className="toolbar-right">
                          <ActionFeedback message={feedback.target === 'drinks' ? feedback.message : null} tone={feedback.tone} />
                          <Button type="submit">Save package</Button>
                        </div>
                      </form>
                    </Card>
                  </div>
                  <div className="reserve-stack">
                    <Card title="Packages" subtitle={`${drinkPackages.length} configured`}>
                      {drinkPackages.length === 0 ? (
                        <EmptyState title="No packages yet" description="Add a drinks package above — it’ll appear on the booking widget for that venue." />
                      ) : (
                        <div className="reserve-timeline">
                          {drinkPackages.map((pkg) => (
                            <div key={pkg.id} className="reserve-summary-card">
                              <strong>{pkg.name} · ${(pkg.priceCents / 100).toFixed(2)}</strong>
                              <span>{pkg.venue}{pkg.description ? ` · ${pkg.description}` : ''}</span>
                              <div className="reserve-note-list">
                                {pkg.isActive ? <Badge tone="positive">Active</Badge> : <Badge tone="neutral">Hidden</Badge>}
                                <Button type="button" size="sm" variant="ghost" onClick={() => void toggleDrinkPackage(pkg)}>
                                  {pkg.isActive ? 'Hide' : 'Show'}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  </div>
                </div>
              </Card>
            </section>
            ) : null}

            {showWidget ? (
            <section id="widget-preview">
              <Card title="Public widget preview" subtitle="Safe slot preview with no internal notes exposed">
              <form className="reserve-form" onSubmit={(event) => void previewWidgetAvailability(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={widgetSearch.venue} onChange={(event) => { const el = event.currentTarget; setWidgetSearch((current) => ({ ...current, venue: el.value })); }} options={(widgetConfig?.venues ?? KNOWN_VENUES.map((name) => ({ name, onlineEnabled: true, activeRules: 0, googleReserveReady: false }))).map((venue) => ({ label: typeof venue === 'string' ? venue : `${venue.name} · ${venue.activeRules} active rules`, value: typeof venue === 'string' ? venue : venue.name }))} />
                  <Input label="Date" type="date" value={widgetSearch.date} onChange={(event) => { const el = event.currentTarget; setWidgetSearch((current) => ({ ...current, date: el.value })); }} />
                  <Input label="Party size" type="number" min="1" max="20" value={widgetSearch.partySize} onChange={(event) => { const el = event.currentTarget; setWidgetSearch((current) => ({ ...current, partySize: el.value })); }} />
                  <Select label="Service" value={widgetSearch.servicePeriod} onChange={(event) => { const el = event.currentTarget; setWidgetSearch((current) => ({ ...current, servicePeriod: el.value as ReserveServicePeriod | '' })); }} options={[{ label: 'Any service', value: '' }, ...SERVICE_PERIODS.map((value) => ({ label: value, value }))]} />
                </div>
                <div className="toolbar-right">
                  <ActionFeedback message={feedback.target === 'widget-preview' ? feedback.message : null} tone={feedback.tone} />
                  <Button type="submit" variant="secondary">Preview availability</Button>
                </div>
              </form>
              <div className="reserve-note-list">
                {(widgetConfig?.limitations ?? []).map((limitation) => (
                  <Badge key={limitation} tone="warning">{limitation}</Badge>
                ))}
              </div>
              {widgetAvailability ? (
                <div className="reserve-slot-grid compact">
                  {widgetAvailability.slots.slice(0, 12).map((slot) => (
                    <div key={slot.startsAt} className="reserve-slot-chip">
                      <strong>{slot.label}</strong>
                      <span>{slot.capacityRemaining} covers</span>
                    </div>
                  ))}
                  {widgetAvailability.slots.length === 0 ? <p className="subtle">No public slots for that request.</p> : null}
                </div>
              ) : null}
              <Button type="button" variant="secondary" onClick={() => window.open(publicWidgetUrl, '_blank', 'noopener,noreferrer')}>
                Open public booking widget
              </Button>
              </Card>
            </section>
            ) : null}

            {showGoogleReserve ? (
            <section id="google-reserve">
              <Card title="Google Reserve setup" subtitle="Setup required. No live feed submission in this pass.">
              <form className="reserve-form" onSubmit={(event) => void saveGoogleReserve(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={integrationForm.venue} onChange={(event) => { const el = event.currentTarget; setIntegrationForm((current) => ({ ...current, venue: el.value })); }} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                  <Select label="Status" value={integrationForm.integrationStatus} onChange={(event) => { const el = event.currentTarget; setIntegrationForm((current) => ({ ...current, integrationStatus: el.value as GoogleReserveIntegrationSetting['integrationStatus'] })); }} options={GOOGLE_STATUSES.map((value) => ({ label: value.replace('_', ' '), value }))} />
                </div>
                <Input label="Merchant ID" value={integrationForm.merchantId || ''} onChange={(event) => { const el = event.currentTarget; setIntegrationForm((current) => ({ ...current, merchantId: el.value || null })); }} />
                <Textarea label="Latest integration note" rows={2} value={integrationForm.lastError || ''} onChange={(event) => { const el = event.currentTarget; setIntegrationForm((current) => ({ ...current, lastError: el.value || null })); }} />
                <label className="reserve-inline-check">
                  <input
                    type="checkbox"
                    checked={integrationForm.enabled}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setIntegrationForm((current) => ({ ...current, enabled: checked }));
                    }}
                  />
                  <span>Integration configured internally. Live partner feed remains disabled until explicit rollout.</span>
                </label>
                <div className="toolbar-right">
                  <ActionFeedback message={feedback.target === 'google-reserve' ? feedback.message : null} tone={feedback.tone} />
                  <Button type="submit">Save setup state</Button>
                </div>
              </form>
              {integration ? (
                <div className="reserve-summary-card">
                  <strong>{integration.venue}</strong>
                  <span>{integration.integrationStatus.replace('_', ' ')} · {integration.enabled ? 'Enabled internally' : 'Disabled'}</span>
                </div>
              ) : (
                <p className="subtle">Choose a specific venue to manage integration readiness.</p>
              )}
              </Card>
            </section>
            ) : null}
          </aside>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

export function App() {
  const auth = useReserveAuth();
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const publicMode = path.includes('/widget');
  const manageMode = path.includes('/manage');

  if (manageMode) return <ManageBookingPage />;
  if (publicMode) return <PublicBookingWidget />;

  if (auth.loading) {
    return (
      <div className="login-page">
        <Spinner label="Checking session" />
      </div>
    );
  }

  if (!auth.user) return <LoginScreen onLogin={auth.login} />;

  return <ReserveWorkspace user={auth.user} onLogout={auth.logout} />;
}
