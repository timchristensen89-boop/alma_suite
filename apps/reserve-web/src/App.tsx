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
  ReservePublicWidgetConfig,
  ReserveReservation,
  ReserveReservationStatus,
  ReserveServicePeriod,
  ReserveTable
} from '@alma/shared';
import {
  ActionFeedback,
  AlmaPill,
  AppShell,
  Badge,
  BigStat,
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
  SuiteCommsWidget,
  SuiteNotificationsWidget,
  Textarea,
  TopBar,
  useDismissibleLayer
} from '@alma/ui';
import { withSuiteAppLinks } from './config/suiteLinks';
import { api, clearApiAuthToken, consumeSuiteHandoffToken, installSuiteHandoff, setApiAuthToken } from './lib/api';

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
  website: 'https://almagroup.com.au/'
};
const RESERVE_PUBLIC_VENUES: Record<string, { location: string; image: string; summary: string; description: string; website: string }> = {
  'Alma Avalon': {
    location: 'Avalon Beach',
    image: '/images/alma-avalon-margaritas.jpg',
    summary: 'Beachside Mexican dining, margaritas, long lunches, and relaxed evening bookings.',
    description: 'A relaxed coastal dining room for tacos, shared plates, margaritas, birthdays, and long lunches near the beach.',
    website: 'https://almagroup.com.au/'
  },
  'St Alma': {
    location: 'Freshwater',
    image: '/images/st-alma-food.JPG',
    summary: 'Coastal dining in Freshwater with bright share plates, cocktails, and group tables.',
    description: 'A bright Freshwater venue for coastal dining, cocktails, group tables, and neighbourhood catch-ups.',
    website: 'https://almagroup.com.au/'
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
  { href: '#floor-plan', label: 'Floor plan', description: 'Drag-drop table layout', icon: <GearIcon /> },
  { href: '#guests', label: 'Guests', description: 'CRM and visit history', icon: <SearchIcon /> },
  { href: '#waitlist', label: 'Waitlist', description: 'Walk-in queue for peak periods', icon: <SearchIcon /> },
  { href: '#availability', label: 'Availability', description: 'Rules and blackouts', icon: <GearIcon /> },
  { href: '#widget-preview', label: 'Widget', description: 'Safe public booking preview', icon: <DocumentIcon /> },
  { href: '#google-reserve', label: 'Google Reserve', description: 'Setup-required integration', icon: <GearIcon /> }
];

type WaitlistEntry = {
  id: string;
  venue: string;
  guestName: string;
  partySize: number;
  phone: string;
  notes: string;
  addedAt: string;
  estimatedWaitMinutes: number | null;
  status: 'WAITING' | 'SEATED' | 'CANCELLED' | 'LEFT';
};

const WAITLIST_STORAGE_KEY = 'alma.reserve.waitlist.v1';

function loadWaitlist(): WaitlistEntry[] {
  try {
    const raw = window.localStorage.getItem(WAITLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistWaitlist(entries: WaitlistEntry[]) {
  try {
    window.localStorage.setItem(WAITLIST_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* storage unavailable */
  }
}

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

function BookingRow({ reservation, feedback, onStatus }: BookingRowProps) {
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

  const active = MANAGER_NAV_ITEMS.find((item) => item.href === activeHash) ?? MANAGER_NAV_ITEMS[0]!;

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
              className={activeHash === item.href ? 'active' : ''}
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
  const [config, setConfig] = useState<ReservePublicWidgetConfig | null>(null);
  const [availability, setAvailability] = useState<ReservePublicAvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [booking, setBooking] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(defaultFeedback());
  const [search, setSearch] = useState<WidgetSearchForm>(() => defaultWidgetSearch(KNOWN_VENUES[0]!));
  const [bookingForm, setBookingForm] = useState<WidgetBookingForm>(defaultWidgetBooking);
  const [selectedSlot, setSelectedSlot] = useState<ReservePublicAvailabilityResponse['slots'][number] | null>(null);
  const [reservation, setReservation] = useState<ReservePublicBookingConfirmation | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setFeedback(defaultFeedback());
    try {
      const nextConfig = await api<ReservePublicWidgetConfig>('/api/reserve/public-widget/config');
      setConfig(nextConfig);
      const firstVenue = nextConfig.venues.find((venue) => venue.onlineEnabled)?.name ?? nextConfig.venues[0]?.name ?? KNOWN_VENUES[0]!;
      setSearch(defaultWidgetSearch(firstVenue));
    } catch (error) {
      setFeedback({
        target: 'widget',
        tone: 'error',
        message: error instanceof Error ? error.message : 'Could not load booking page'
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const requestAvailability = useCallback(async (nextSearch: WidgetSearchForm) => {
    setSearching(true);
    setFeedback(defaultFeedback());
    setSelectedSlot(null);
    setReservation(null);
    try {
      setAvailability(
        await api<ReservePublicAvailabilityResponse>('/api/reserve/public-widget/availability', {
          method: 'POST',
          body: JSON.stringify({
            venue: nextSearch.venue,
            date: `${nextSearch.date}T00:00:00`,
            partySize: Number(nextSearch.partySize || 1),
            servicePeriod: nextSearch.servicePeriod
          })
        })
      );
    } catch (error) {
      setFeedback({
        target: 'widget-search',
        tone: 'error',
        message: error instanceof Error ? error.message : 'Could not check availability'
      });
    } finally {
      setSearching(false);
    }
  }, []);

  async function checkAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await requestAvailability(search);
  }

  async function tryAnotherDate(date: string) {
    const nextSearch = { ...search, date };
    setSearch(nextSearch);
    await requestAvailability(nextSearch);
  }

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot) return;
    setBooking(true);
    setFeedback(defaultFeedback());
    try {
      const created = await api<ReservePublicBookingConfirmation>('/api/reserve/public-widget/book', {
        method: 'POST',
        body: JSON.stringify({
          venue: search.venue,
          availabilityRuleId: selectedSlot.availabilityRuleId || '',
          serviceDate: `${search.date}T00:00:00`,
          startsAt: selectedSlot.startsAt,
          partySize: Number(search.partySize || 1),
          durationMinutes: Math.round((new Date(selectedSlot.endsAt).getTime() - new Date(selectedSlot.startsAt).getTime()) / 60_000),
          ...bookingForm
        })
      });
      setReservation(created);
      setFeedback({
        target: 'widget-booking',
        tone: 'success',
        message: 'Booking request received. The venue team has the details and will follow up if anything needs to change.'
      });
    } catch (error) {
      setFeedback({
        target: 'widget-booking',
        tone: 'error',
        message: error instanceof Error ? error.message : 'Could not confirm booking'
      });
    } finally {
      setBooking(false);
    }
  }

  const configuredVenues = config?.venues.length
    ? config.venues
    : KNOWN_VENUES.map((name) => ({ name, onlineEnabled: false, activeRules: 0, googleReserveReady: false }));
  const venueOptions = configuredVenues
    .map((venue) => ({
      activeRules: venue.activeRules,
      detail: RESERVE_PUBLIC_VENUES[venue.name] ?? DEFAULT_RESERVE_PUBLIC_VENUE,
      onlineEnabled: venue.onlineEnabled,
      value: venue.name
    }));
  const selectedVenue = venueOptions.find((venue) => venue.value === search.venue) ?? venueOptions[0];
  const selectedVenueDetail = selectedVenue?.detail ?? RESERVE_PUBLIC_VENUES[search.venue] ?? DEFAULT_RESERVE_PUBLIC_VENUE;
  const groupedSlots = useMemo(() => {
    const groups = new Map<string, ReservePublicAvailabilityResponse['slots']>();
    for (const slot of availability?.slots ?? []) {
      const key = slotDateKey(slot.startsAt);
      groups.set(key, [...(groups.get(key) ?? []), slot]);
    }
    return Array.from(groups.entries()).map(([date, slots]) => ({ date, slots }));
  }, [availability]);
  const alternateDates = nextDateOptions(search.date);
  const noAvailabilityTitle = selectedVenue?.onlineEnabled
    ? `No online tables for ${longDate(`${search.date}T00:00:00`)}`
    : `${search.venue} is not taking online bookings for this service`;

  function chooseVenue(venue: string) {
    setSearch((current) => ({ ...current, venue }));
    setAvailability(null);
    setSelectedSlot(null);
    setReservation(null);
    setFeedback(defaultFeedback());
  }

  return (
    <main className="login-page reserve-widget-page">
      <div className="reserve-widget-shell">
        <header className="reserve-public-header">
          <div className="reserve-public-brand" aria-label="Alma Group reservations">
            <img src="/brand/alma-fish.png" alt="" />
            <span>Alma Group</span>
          </div>
          <a href="https://almagroup.com.au/" className="reserve-public-header-link">Visit website</a>
        </header>
        <section className="reserve-public-hero" style={{ backgroundImage: `linear-gradient(180deg, rgba(40, 4, 16, 0.1), rgba(40, 4, 16, 0.62)), url(${selectedVenueDetail.image})` }}>
          <div className="reserve-public-hero-copy">
            <p className="reserve-public-eyebrow">Alma Group reservations</p>
            <h1>{search.venue}</h1>
            <p>{selectedVenueDetail.summary}</p>
            <button
              type="button"
              className="reserve-public-hero-cta"
              onClick={() => document.querySelector('.reserve-public-booking-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              Book a table
            </button>
          </div>
        </section>
        <section className="reserve-public-layout" aria-label="Book a table">
          <div className="reserve-public-primary">
            {reservation ? (
              <section className="reserve-public-confirmation" aria-live="polite">
                <div className="reserve-public-confirmation-icon" aria-hidden="true">✓</div>
                <div className="reserve-public-confirmation-text">
                  <p className="reserve-public-eyebrow">Booking sent</p>
                  <h2>Thanks {reservation.guestName.split(' ')[0]}, your table request is in</h2>
                  <p>{shortDate(reservation.serviceDate)} · {timeLabel(reservation.startsAt)} · {reservation.covers} guests at {search.venue}</p>
                  <small>The venue team will confirm by email shortly. For urgent changes, please call the restaurant directly.</small>
                </div>
              </section>
            ) : null}
            <section className="reserve-public-booking-panel reserve-public-floating-panel">
              {loading ? <Spinner label="Loading booking form..." /> : null}
              {feedback.target === 'widget' && feedback.message ? <p className="error-text">{feedback.message}</p> : null}
              {!loading && config ? (
                <form className="reserve-public-search" onSubmit={(event) => void checkAvailability(event)}>
                  <div className="reserve-venue-tabs" aria-label="Choose a venue">
                    {venueOptions.map((venue) => (
                      <button
                        key={venue.value}
                        type="button"
                        className={`reserve-venue-tab ${search.venue === venue.value ? 'active' : ''}`}
                        onClick={() => chooseVenue(venue.value)}
                        aria-pressed={search.venue === venue.value}
                      >
                        <span>{venue.value}</span>
                        <small>{venue.detail.location}</small>
                      </button>
                    ))}
                  </div>
                  <div className="reserve-public-search-grid">
                    <Input
                      label="Guests"
                      type="number"
                      min="1"
                      max="20"
                      value={search.partySize}
                      onChange={(event) => setSearch((current) => ({ ...current, partySize: event.currentTarget.value }))}
                    />
                    <Input
                      label="Date"
                      type="date"
                      value={search.date}
                      onChange={(event) => setSearch((current) => ({ ...current, date: event.currentTarget.value }))}
                    />
                    <Select
                      label="Time"
                      value={search.servicePeriod}
                      onChange={(event) => setSearch((current) => ({ ...current, servicePeriod: event.currentTarget.value as ReserveServicePeriod | '' }))}
                      options={[{ label: 'Any time', value: '' }, ...SERVICE_PERIODS.map((value) => ({ label: servicePeriodLabels[value], value }))]}
                    />
                    <Button type="submit" disabled={searching}>{searching ? 'Checking...' : 'Search'}</Button>
                  </div>
                  <ActionFeedback
                    message={feedback.target === 'widget-search' ? feedback.message : null}
                    tone={feedback.tone}
                  />
                </form>
              ) : null}
            </section>

            <p className="reserve-public-help-note">
              For larger groups or special requests, the venue team may follow up before confirming the booking details.
            </p>

            {/* Function / event enquiry — for groups 10+ or special occasions */}
            <FunctionEnquiryPanel venue={search.venue} />


            {availability ? (
              <section className="reserve-public-section">
                <div className="reserve-public-section-heading">
                  <div>
                    <p className="reserve-public-eyebrow">Available times</p>
                    <h2>{availability.partySize} guests at {search.venue} on {shortDate(availability.serviceDate)}</h2>
                  </div>
                  {selectedSlot ? (
                    <button type="button" className="reserve-change-time" onClick={() => setSelectedSlot(null)}>
                      Change time
                    </button>
                  ) : null}
                </div>
                {availability.slots.length === 0 ? (
                  <div className="reserve-empty-availability">
                    <EmptyState
                      title={noAvailabilityTitle}
                      description="We would still love to see you. Choose another date below or adjust the time and guest count."
                    />
                    <div className="reserve-alternate-dates" aria-label="Try another date">
                      <p>Try another date</p>
                      <div>
                        {alternateDates.map((date) => (
                          <button key={date} type="button" onClick={() => void tryAnotherDate(date)} disabled={searching}>
                            <strong>{shortDate(`${date}T00:00:00`)}</strong>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="reserve-slot-date-groups">
                    {groupedSlots.map((group) => (
                      <section key={group.date} className="reserve-slot-date-group">
                        <h3>{shortDate(`${group.date}T00:00:00`)}</h3>
                        <div className="reserve-slot-grid">
                          {group.slots.map((slot) => (
                            <button
                              key={`${slot.startsAt}-${slot.availabilityRuleId ?? 'any'}`}
                              type="button"
                              className={`reserve-slot-button ${selectedSlot?.startsAt === slot.startsAt ? 'active' : ''}`}
                              onClick={() => setSelectedSlot(slot)}
                            >
                              <strong>{slot.label}</strong>
                              <span>{serviceCopy(slot.servicePeriod)}</span>
                              <small>{slot.capacityRemaining} covers left</small>
                            </button>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              !loading && config ? (
                <section className="reserve-public-section reserve-public-ready-state">
                  <p className="reserve-public-eyebrow">Find a table</p>
                  <h2>Choose guests, date, and time to see live availability.</h2>
                  <p>No demo times are shown here. Results come from the venue availability rules in Alma Reserve.</p>
                </section>
              ) : null
            )}

            {selectedSlot ? (
              <section className="reserve-public-section">
                  <div className="reserve-public-section-heading">
                    <div>
                      <p className="reserve-public-eyebrow">Guest details</p>
                      <h2>{timeLabel(selectedSlot.startsAt)} at {search.venue}</h2>
                      <p className="reserve-public-selection-summary">
                        {search.partySize} guests · {shortDate(selectedSlot.startsAt)} · {serviceCopy(selectedSlot.servicePeriod)}
                      </p>
                    </div>
                    <button type="button" className="reserve-change-time" onClick={() => setSelectedSlot(null)}>
                      Change time
                    </button>
                  </div>
                  <form className="reserve-form" onSubmit={(event) => void submitBooking(event)}>
                    <div className="form-grid two">
                      <Input label="First name" required value={bookingForm.firstName} onChange={(event) => setBookingForm((current) => ({ ...current, firstName: event.currentTarget.value }))} />
                      <Input label="Last name" required value={bookingForm.lastName} onChange={(event) => setBookingForm((current) => ({ ...current, lastName: event.currentTarget.value }))} />
                      <Input label="Email" type="email" value={bookingForm.email} onChange={(event) => setBookingForm((current) => ({ ...current, email: event.currentTarget.value }))} />
                      <Input label="Phone" required value={bookingForm.phone} onChange={(event) => setBookingForm((current) => ({ ...current, phone: event.currentTarget.value }))} />
                      <Input label="Birthday" type="date" value={bookingForm.birthday} onChange={(event) => setBookingForm((current) => ({ ...current, birthday: event.currentTarget.value }))} />
                      <Input label="Anniversary" type="date" value={bookingForm.anniversary} onChange={(event) => setBookingForm((current) => ({ ...current, anniversary: event.currentTarget.value }))} />
                    </div>
                    <Input label="Occasion" value={bookingForm.occasion} onChange={(event) => setBookingForm((current) => ({ ...current, occasion: event.currentTarget.value }))} />
                    <Select
                      label="Seating preference"
                      value={bookingForm.seatingPreference}
                      onChange={(event) => setBookingForm((current) => ({ ...current, seatingPreference: event.currentTarget.value }))}
                      options={[
                        { label: 'No preference', value: '' },
                        { label: 'Outdoor', value: 'outdoor' },
                        { label: 'Bar seating', value: 'bar' },
                        { label: 'Accessible table', value: 'accessibility' }
                      ]}
                    />
                    <Textarea label="Dietary notes" rows={2} value={bookingForm.dietaryNotes} onChange={(event) => setBookingForm((current) => ({ ...current, dietaryNotes: event.currentTarget.value }))} />
                    <Textarea label="Special requests" rows={3} value={bookingForm.specialRequests} onChange={(event) => setBookingForm((current) => ({ ...current, specialRequests: event.currentTarget.value }))} />
                    <div className="reserve-note-list">
                      {BOOKING_PREFERENCE_FIELDS.map(({ key, label }) => (
                        <label key={key} className="reserve-inline-check">
                          <input
                            type="checkbox"
                            checked={bookingForm[key]}
                            onChange={(event) => {
                              const checked = event.currentTarget.checked;
                              setBookingForm((current) => ({ ...current, [key]: checked }));
                            }}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    <label className="reserve-inline-check">
                      <input
                        type="checkbox"
                        checked={bookingForm.marketingOptIn}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setBookingForm((current) => ({ ...current, marketingOptIn: checked }));
                        }}
                      />
                      <span>Send me future restaurant updates for this venue.</span>
                    </label>
                    <div className="reserve-public-actions">
                      <ActionFeedback
                        message={feedback.target === 'widget-booking' ? feedback.message : null}
                        tone={feedback.tone}
                      />
                      <Button type="submit" disabled={booking}>{booking ? 'Sending...' : 'Request booking'}</Button>
                    </div>
                  </form>
                  {reservation ? (
                    <div className="reserve-summary-card">
                      <strong>{reservation.guestName}</strong>
                      <span>{shortDate(reservation.serviceDate)} · {timeLabel(reservation.startsAt)} · {reservation.covers} guests</span>
                    </div>
                  ) : null}
                </section>
            ) : null}
          </div>
          <aside className="reserve-public-info-card" aria-label="Venue information">
            <img src={selectedVenueDetail.image} alt={`${search.venue} venue`} />
            <div>
              <p className="reserve-public-eyebrow">Venue</p>
              <h2>{search.venue}</h2>
              <p>{selectedVenueDetail.description}</p>
              <dl>
                <div>
                  <dt>Location</dt>
                  <dd>{selectedVenueDetail.location}</dd>
                </div>
                <div>
                  <dt>Booking status</dt>
                  <dd>{selectedVenue?.onlineEnabled ? 'Online booking requests open' : 'Limited online availability'}</dd>
                </div>
              </dl>
              <a href={selectedVenueDetail.website} target="_blank" rel="noreferrer">Open venue website</a>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function TopBarWithContext({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const [activeHash, setActiveHash] = useState(() => window.location.hash || '#dashboard');

  useEffect(() => {
    const sync = () => setActiveHash(window.location.hash || '#dashboard');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const active = MANAGER_NAV_ITEMS.find((item) => item.href === activeHash) ?? MANAGER_NAV_ITEMS[0]!;

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
          <SuiteCommsWidget
            appId="RESERVE"
            api={api}
            venue={user.venue}
            userName={`${user.firstName} ${user.lastName}`}
            canAnnounce={user.role !== 'STAFF'}
          />
          <SuiteNotificationsWidget api={api} currentApp="reserve" />
          <Button size="sm" type="button" variant="secondary" onClick={() => void onLogout()}>Sign out</Button>
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
  const [entries, setEntries] = useState<WaitlistEntry[]>(() => loadWaitlist());
  const [draft, setDraft] = useState({
    venue: defaultVenue,
    guestName: '',
    partySize: '2',
    phone: '',
    notes: '',
    estimatedWaitMinutes: ''
  });

  useEffect(() => {
    persistWaitlist(entries);
  }, [entries]);

  function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.guestName.trim()) return;
    const entry: WaitlistEntry = {
      id: `wl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      venue: draft.venue,
      guestName: draft.guestName.trim(),
      partySize: Math.max(1, Number(draft.partySize) || 1),
      phone: draft.phone.trim(),
      notes: draft.notes.trim(),
      addedAt: new Date().toISOString(),
      estimatedWaitMinutes: draft.estimatedWaitMinutes ? Number(draft.estimatedWaitMinutes) : null,
      status: 'WAITING'
    };
    setEntries((current) => [entry, ...current]);
    setDraft({
      venue: draft.venue,
      guestName: '',
      partySize: '2',
      phone: '',
      notes: '',
      estimatedWaitMinutes: ''
    });
  }

  function updateStatus(id: string, status: WaitlistEntry['status']) {
    setEntries((current) => current.map((e) => (e.id === id ? { ...e, status } : e)));
  }

  function removeEntry(id: string) {
    setEntries((current) => current.filter((e) => e.id !== id));
  }

  const waiting = entries.filter((e) => e.status === 'WAITING');
  const resolved = entries.filter((e) => e.status !== 'WAITING').slice(0, 8);

  function timeSinceAdded(iso: string) {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
  }

  return (
    <Card
      title="Waitlist"
      subtitle="Walk-in queue for peak service periods. Stored locally per browser — sync to the API in a future release."
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
            max="20"
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
        <div className="toolbar-right">
          <Button type="submit">Add to waitlist</Button>
        </div>
      </form>

      <div className="waitlist-stack">
        <div className="waitlist-section-head">
          <strong>Currently waiting · {waiting.length}</strong>
        </div>
        {waiting.length === 0 ? (
          <EmptyState
            title="No one waiting"
            description="Add walk-ins as they arrive to track the queue and wait times."
          />
        ) : (
          waiting.map((entry) => (
            <div key={entry.id} className="waitlist-row is-waiting">
              <div className="waitlist-row-main">
                <strong>{entry.guestName}</strong>
                <span>{entry.partySize} {entry.partySize === 1 ? 'guest' : 'guests'} · {entry.venue}</span>
                <small>
                  Added {timeSinceAdded(entry.addedAt)}
                  {entry.estimatedWaitMinutes !== null ? ` · Est. wait ${entry.estimatedWaitMinutes}m` : ''}
                  {entry.phone ? ` · ${entry.phone}` : ''}
                </small>
                {entry.notes ? <em>{entry.notes}</em> : null}
              </div>
              <div className="waitlist-row-actions">
                <Button type="button" size="sm" onClick={() => updateStatus(entry.id, 'SEATED')}>Seated</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => updateStatus(entry.id, 'LEFT')}>Left</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => updateStatus(entry.id, 'CANCELLED')}>Cancel</Button>
              </div>
            </div>
          ))
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
                  <small>{entry.status === 'SEATED' ? 'Seated' : entry.status === 'LEFT' ? 'Left without staying' : 'Cancelled'} · added {timeSinceAdded(entry.addedAt)}</small>
                </div>
                <div className="waitlist-row-actions">
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeEntry(entry.id)}>Clear</Button>
                </div>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </Card>
  );
}

// Per-venue table position storage. Backend doesn't track x/y coordinates,
// so we persist them in localStorage keyed by venue. Each venue's layout is
// the host's local layout — fine for single-venue use; for cross-device sync
// the positions would need to move to the backend (StockItem-like venue
// table positions table).
type TablePosition = { x: number; y: number };
function loadFloorLayout(venue: string): Record<string, TablePosition> {
  try {
    const raw = window.localStorage.getItem(`alma.reserve.floor.${venue}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}
function persistFloorLayout(venue: string, layout: Record<string, TablePosition>) {
  try {
    window.localStorage.setItem(`alma.reserve.floor.${venue}`, JSON.stringify(layout));
  } catch {
    /* swallow */
  }
}

function FloorPlanSection({
  venue,
  tables,
  reservations,
  onAssignTable
}: {
  venue: string;
  tables: ReserveTable[];
  reservations: ReserveReservation[];
  onAssignTable: (reservationId: string, tableId: string | null) => void | Promise<void>;
}) {
  const [layouts, setLayouts] = useState<Record<string, Record<string, TablePosition>>>(() => {
    const initial: Record<string, Record<string, TablePosition>> = {};
    for (const tableVenue of Array.from(new Set(tables.map((t) => t.venue)))) {
      initial[tableVenue] = loadFloorLayout(tableVenue);
    }
    if (!initial[venue]) initial[venue] = loadFloorLayout(venue);
    return initial;
  });
  const [editMode, setEditMode] = useState(false);
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const [draggingReservationId, setDraggingReservationId] = useState<string | null>(null);
  const [dropTargetTableId, setDropTargetTableId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Refresh layout when venue changes
  useEffect(() => {
    setLayouts((current) => ({
      ...current,
      [venue]: current[venue] ?? loadFloorLayout(venue)
    }));
  }, [venue]);

  // Persist when layout changes
  useEffect(() => {
    const layout = layouts[venue];
    if (layout) persistFloorLayout(venue, layout);
  }, [venue, layouts]);

  const layout = layouts[venue] ?? {};

  // Auto-place new tables in a grid if they don't have a saved position
  const positionedTables = tables.map((table, index) => {
    const saved = layout[table.id];
    if (saved) return { table, x: saved.x, y: saved.y };
    // Auto-grid: 4 columns
    const col = index % 4;
    const row = Math.floor(index / 4);
    return { table, x: 8 + col * 22, y: 12 + row * 20 };
  });

  function updateTablePosition(tableId: string, x: number, y: number) {
    setLayouts((current) => ({
      ...current,
      [venue]: {
        ...(current[venue] ?? {}),
        [tableId]: { x, y }
      }
    }));
  }

  function handleTableMouseDown(event: ReactMouseEvent<HTMLDivElement>, tableId: string) {
    if (!editMode) return;
    event.preventDefault();
    setDraggingTableId(tableId);
  }

  function handleCanvasMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    if (!draggingTableId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(2, Math.min(96, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(2, Math.min(94, ((event.clientY - rect.top) / rect.height) * 100));
    updateTablePosition(draggingTableId, x, y);
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
      subtitle={`${tables.length} table${tables.length === 1 ? '' : 's'} at ${venue}. ${editMode ? 'Drag tables to position them. Tap Done when finished.' : "Drag a booking from the side list onto a table to assign it. Tap Edit to rearrange tables."}`}
      action={
        <Button
          type="button"
          size="sm"
          variant={editMode ? 'primary' : 'secondary'}
          onClick={() => setEditMode((current) => !current)}
        >
          {editMode ? '✓ Done arranging' : '✎ Edit layout'}
        </Button>
      }
    >
      <div className="floor-plan-layout">
        {/* Canvas */}
        <div
          ref={canvasRef}
          className={`floor-plan-canvas ${editMode ? 'is-editing' : ''}`}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        >
          {positionedTables.map(({ table, x, y }) => {
            const tableBookings = reservationsByTable.get(table.id) ?? [];
            const occupancy = tableBookings.length;
            const tone = occupancy === 0 ? 'free' : tableBookings.some((r) => r.status === 'SEATED') ? 'seated' : 'booked';
            const isDropTarget = dropTargetTableId === table.id;
            return (
              <div
                key={table.id}
                className={`floor-plan-table is-${tone}${isDropTarget ? ' is-drop-target' : ''}${draggingTableId === table.id ? ' is-dragging' : ''}`}
                style={{ left: `${x}%`, top: `${y}%`, cursor: editMode ? 'move' : 'default' }}
                onMouseDown={(event) => handleTableMouseDown(event, table.id)}
                onDragOver={(event) => handleTableDragOver(event, table.id)}
                onDragLeave={() => setDropTargetTableId((current) => (current === table.id ? null : current))}
                onDrop={(event) => handleTableDrop(event, table.id)}
              >
                <span className="floor-plan-table-label">{table.label}</span>
                <span className="floor-plan-table-area">{table.area}</span>
                <span className="floor-plan-table-capacity">{table.minCovers}–{table.maxCovers} guests</span>
                {tableBookings.length > 0 ? (
                  <div className="floor-plan-table-bookings">
                    {tableBookings.slice(0, 2).map((r) => (
                      <span key={r.id} title={`${r.guestName} · ${r.covers} guests`}>
                        {r.guestName?.split(' ')[0] ?? 'Guest'} · {r.covers}p
                      </span>
                    ))}
                    {tableBookings.length > 2 ? <span>+{tableBookings.length - 2}</span> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {positionedTables.length === 0 ? (
            <div className="floor-plan-empty">No tables placed</div>
          ) : null}
        </div>

        {/* Side panel: unassigned reservations to drag onto tables */}
        <aside className="floor-plan-side">
          <strong className="floor-plan-side-head">
            Today's bookings · {unassignedReservations.length} unassigned
          </strong>
          {unassignedReservations.length === 0 ? (
            <p className="subtle">All of today's bookings have a table. Drag any one off a table to unassign — or open the booking to change.</p>
          ) : null}
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
  const [integration, setIntegration] = useState<GoogleReserveIntegrationSetting | null>(null);
  const [widgetConfig, setWidgetConfig] = useState<ReservePublicWidgetConfig | null>(null);
  const [widgetAvailability, setWidgetAvailability] = useState<ReservePublicAvailabilityResponse | null>(null);
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [guestDetail, setGuestDetail] = useState<MarketingGuestDetail | null>(null);
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

      const [nextDashboard, nextDiary, nextGuests, nextTables, nextRules, nextBlackouts, nextWidgetConfig, nextIntegration] =
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
          scopedVenueParam ? api<GoogleReserveIntegrationSetting>(join('/api/reserve/google-reserve-settings', [venueQuery])) : Promise.resolve(null)
        ]);

      setDashboard(nextDashboard);
      setDiary(nextDiary);
      setGuests(nextGuests);
      setTables(nextTables);
      setRules(nextRules);
      setBlackouts(nextBlackouts);
      setWidgetConfig(nextWidgetConfig);
      setIntegration(nextIntegration);
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

  const tableOptions = [{ label: 'Unassigned', value: '' }, ...tables.map((table) => ({ label: `${table.label} · ${table.area}`, value: table.id }))];
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
          marketingOptIn: reservationForm.marketingOptIn
        })
      });
      setReservationForm(defaultReservationForm(reservationForm.venue));
      setSuccess('reservation', 'Booking saved to the live Reserve diary.');
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
          // Editorial Bookings · tonight header
          const isToday = selectedDate === new Date().toISOString().slice(0, 10);
          const venueLabel = venueFilter === 'all' ? 'All venues' : venueFilter;
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

        <div className="reserve-layout">
          <section className="reserve-main">
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

            <section id="waitlist">
              <WaitlistSection defaultVenue={venueFilter === 'all' ? KNOWN_VENUES[0]! : venueFilter} venueOptions={venueOptions} />
            </section>

            <section id="floor-plan">
              <FloorPlanSection
                venue={venueFilter === 'all' ? KNOWN_VENUES[0]! : venueFilter}
                tables={tables.filter((t) => t.isActive && (venueFilter === 'all' || t.venue === venueFilter))}
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
              />
            </section>

            <section id="availability">
              <Card title="Availability rules and blackouts" subtitle="The first safe online-booking layer">
              <div className="reserve-section-grid">
                <div className="reserve-stack">
                  <Card title="Availability rules" subtitle="Capacity-based slots, venue scoped">
                    <form className="reserve-form" onSubmit={(event) => void saveRule(event)}>
                      <div className="form-grid two">
                        <Select label="Venue" value={ruleForm.venue} onChange={(event) => setRuleForm((current) => ({ ...current, venue: event.currentTarget.value }))} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                        <Input label="Rule name" required value={ruleForm.name} onChange={(event) => setRuleForm((current) => ({ ...current, name: event.currentTarget.value }))} />
                        <Select label="Service" value={ruleForm.servicePeriod} onChange={(event) => setRuleForm((current) => ({ ...current, servicePeriod: event.currentTarget.value as ReserveServicePeriod }))} options={SERVICE_PERIODS.map((value) => ({ label: value, value }))} />
                        <Input label="Capacity" type="number" min="1" value={ruleForm.capacity} onChange={(event) => setRuleForm((current) => ({ ...current, capacity: event.currentTarget.value }))} />
                        <Input label="Start" type="time" value={ruleForm.startTime} onChange={(event) => setRuleForm((current) => ({ ...current, startTime: event.currentTarget.value }))} />
                        <Input label="End" type="time" value={ruleForm.endTime} onChange={(event) => setRuleForm((current) => ({ ...current, endTime: event.currentTarget.value }))} />
                        <Input label="Interval mins" type="number" min="15" value={ruleForm.intervalMinutes} onChange={(event) => setRuleForm((current) => ({ ...current, intervalMinutes: event.currentTarget.value }))} />
                        <Input label="Duration mins" type="number" min="30" value={ruleForm.defaultDurationMinutes} onChange={(event) => setRuleForm((current) => ({ ...current, defaultDurationMinutes: event.currentTarget.value }))} />
                        <Input label="Min party" type="number" min="1" value={ruleForm.minPartySize} onChange={(event) => setRuleForm((current) => ({ ...current, minPartySize: event.currentTarget.value }))} />
                        <Input label="Max party" type="number" min="1" value={ruleForm.maxPartySize} onChange={(event) => setRuleForm((current) => ({ ...current, maxPartySize: event.currentTarget.value }))} />
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
                        <Select label="Venue" value={blackoutForm.venue} onChange={(event) => setBlackoutForm((current) => ({ ...current, venue: event.currentTarget.value }))} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                        <Input label="Name" required value={blackoutForm.name} onChange={(event) => setBlackoutForm((current) => ({ ...current, name: event.currentTarget.value }))} />
                        <Input label="Start" type="datetime-local" value={blackoutForm.startAt} onChange={(event) => setBlackoutForm((current) => ({ ...current, startAt: event.currentTarget.value }))} />
                        <Input label="End" type="datetime-local" value={blackoutForm.endAt} onChange={(event) => setBlackoutForm((current) => ({ ...current, endAt: event.currentTarget.value }))} />
                      </div>
                      <Textarea label="Reason" rows={3} value={blackoutForm.reason} onChange={(event) => setBlackoutForm((current) => ({ ...current, reason: event.currentTarget.value }))} />
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
          </section>

          <aside className="reserve-side">
            <Card title="Quick create booking" subtitle="Manager-entered reservation with guest consent capture">
              <form className="reserve-form" onSubmit={(event) => void saveReservation(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={reservationForm.venue} onChange={(event) => setReservationForm((current) => ({ ...current, venue: event.currentTarget.value }))} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                  <Select label="Service" value={reservationForm.servicePeriod} onChange={(event) => setReservationForm((current) => ({ ...current, servicePeriod: event.currentTarget.value as ReserveServicePeriod }))} options={SERVICE_PERIODS.map((value) => ({ label: value, value }))} />
                  <Input label="Date" type="date" value={reservationForm.serviceDate} onChange={(event) => setReservationForm((current) => ({ ...current, serviceDate: event.currentTarget.value }))} />
                  <Input label="Time" type="time" value={reservationForm.time} onChange={(event) => setReservationForm((current) => ({ ...current, time: event.currentTarget.value }))} />
                  <Input label="Guests" type="number" min="1" value={reservationForm.covers} onChange={(event) => setReservationForm((current) => ({ ...current, covers: event.currentTarget.value }))} />
                  <Input label="Duration mins" type="number" min="30" value={reservationForm.durationMinutes} onChange={(event) => setReservationForm((current) => ({ ...current, durationMinutes: event.currentTarget.value }))} />
                  <Select label="Table" value={reservationForm.tableId} onChange={(event) => setReservationForm((current) => ({ ...current, tableId: event.currentTarget.value }))} options={tableOptions} />
                  <Select label="Rule" value={reservationForm.availabilityRuleId} onChange={(event) => setReservationForm((current) => ({ ...current, availabilityRuleId: event.currentTarget.value }))} options={ruleOptions} />
                  <Input label="First name" required value={reservationForm.firstName} onChange={(event) => setReservationForm((current) => ({ ...current, firstName: event.currentTarget.value }))} />
                  <Input label="Last name" required value={reservationForm.lastName} onChange={(event) => setReservationForm((current) => ({ ...current, lastName: event.currentTarget.value }))} />
                  <Input label="Email" type="email" value={reservationForm.email} onChange={(event) => setReservationForm((current) => ({ ...current, email: event.currentTarget.value }))} />
                  <Input label="Phone" value={reservationForm.phone} onChange={(event) => setReservationForm((current) => ({ ...current, phone: event.currentTarget.value }))} />
                  <Select label="Status" value={reservationForm.status} onChange={(event) => setReservationForm((current) => ({ ...current, status: event.currentTarget.value as ReserveReservationStatus }))} options={RESERVATION_STATUSES.map((value) => ({ label: value.replace('_', ' '), value }))} />
                  <Input label="Occasion" value={reservationForm.occasion} onChange={(event) => setReservationForm((current) => ({ ...current, occasion: event.currentTarget.value }))} />
                </div>
                <Textarea label="Special requests" rows={2} value={reservationForm.specialRequests} onChange={(event) => setReservationForm((current) => ({ ...current, specialRequests: event.currentTarget.value }))} />
                <Textarea label="Internal notes" rows={2} value={reservationForm.internalNotes} onChange={(event) => setReservationForm((current) => ({ ...current, internalNotes: event.currentTarget.value }))} />
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

            <Card title="Tables" subtitle="Lightweight table map foundation">
              <form className="reserve-form" onSubmit={(event) => void saveTable(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={tableForm.venue} onChange={(event) => setTableForm((current) => ({ ...current, venue: event.currentTarget.value }))} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                  <Input label="Area" value={tableForm.area} onChange={(event) => setTableForm((current) => ({ ...current, area: event.currentTarget.value }))} />
                  <Input label="Label" required value={tableForm.label} onChange={(event) => setTableForm((current) => ({ ...current, label: event.currentTarget.value }))} />
                  <Input label="Min covers" type="number" min="1" value={tableForm.minCovers} onChange={(event) => setTableForm((current) => ({ ...current, minCovers: event.currentTarget.value }))} />
                  <Input label="Max covers" type="number" min="1" value={tableForm.maxCovers} onChange={(event) => setTableForm((current) => ({ ...current, maxCovers: event.currentTarget.value }))} />
                  <Input label="Sort" type="number" value={tableForm.sortOrder} onChange={(event) => setTableForm((current) => ({ ...current, sortOrder: event.currentTarget.value }))} />
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

            <section id="widget-preview">
              <Card title="Public widget preview" subtitle="Safe slot preview with no internal notes exposed">
              <form className="reserve-form" onSubmit={(event) => void previewWidgetAvailability(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={widgetSearch.venue} onChange={(event) => setWidgetSearch((current) => ({ ...current, venue: event.currentTarget.value }))} options={(widgetConfig?.venues ?? KNOWN_VENUES.map((name) => ({ name, onlineEnabled: true, activeRules: 0, googleReserveReady: false }))).map((venue) => ({ label: typeof venue === 'string' ? venue : `${venue.name} · ${venue.activeRules} active rules`, value: typeof venue === 'string' ? venue : venue.name }))} />
                  <Input label="Date" type="date" value={widgetSearch.date} onChange={(event) => setWidgetSearch((current) => ({ ...current, date: event.currentTarget.value }))} />
                  <Input label="Party size" type="number" min="1" max="20" value={widgetSearch.partySize} onChange={(event) => setWidgetSearch((current) => ({ ...current, partySize: event.currentTarget.value }))} />
                  <Select label="Service" value={widgetSearch.servicePeriod} onChange={(event) => setWidgetSearch((current) => ({ ...current, servicePeriod: event.currentTarget.value as ReserveServicePeriod | '' }))} options={[{ label: 'Any service', value: '' }, ...SERVICE_PERIODS.map((value) => ({ label: value, value }))]} />
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

            <section id="google-reserve">
              <Card title="Google Reserve setup" subtitle="Setup required. No live feed submission in this pass.">
              <form className="reserve-form" onSubmit={(event) => void saveGoogleReserve(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={integrationForm.venue} onChange={(event) => setIntegrationForm((current) => ({ ...current, venue: event.currentTarget.value }))} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                  <Select label="Status" value={integrationForm.integrationStatus} onChange={(event) => setIntegrationForm((current) => ({ ...current, integrationStatus: event.currentTarget.value as GoogleReserveIntegrationSetting['integrationStatus'] }))} options={GOOGLE_STATUSES.map((value) => ({ label: value.replace('_', ' '), value }))} />
                </div>
                <Input label="Merchant ID" value={integrationForm.merchantId || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, merchantId: event.currentTarget.value || null }))} />
                <Textarea label="Latest integration note" rows={2} value={integrationForm.lastError || ''} onChange={(event) => setIntegrationForm((current) => ({ ...current, lastError: event.currentTarget.value || null }))} />
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
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

export function App() {
  const auth = useReserveAuth();
  const publicMode = typeof window !== 'undefined' && window.location.pathname.includes('/widget');

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
