import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AuthUser,
  ReserveDiarySummary,
  ReserveReservation,
  ReserveReservationStatus,
  ReserveServicePeriod,
  ReserveTable
} from '@alma/shared';
import {
  AppShell,
  Badge,
  Button,
  Card,
  DocumentIcon,
  EmptyState,
  GearIcon,
  Input,
  PageHeader,
  ProductLogo,
  SearchIcon,
  Select,
  Spinner,
  StatCard,
  SUITE_APPS,
  SuiteAppSwitcher,
  Textarea,
  TopBar
} from '@alma/ui';
import { api, clearApiAuthToken, consumeSuiteHandoffToken, installSuiteHandoff, setApiAuthToken } from './lib/api';
import { withSuiteAppLinks } from './config/suiteLinks';

const suiteApps = withSuiteAppLinks(SUITE_APPS);
const VENUES = ['Alma Avalon', 'St Alma'];
const PERIODS: ReserveServicePeriod[] = ['LUNCH', 'DINNER', 'EVENT'];
const STATUSES: ReserveReservationStatus[] = ['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
const RESERVE_NAV_ITEMS = [
  {
    href: '#diary',
    label: 'Diary',
    description: 'Bookings by service',
    icon: <DocumentIcon />
  },
  {
    href: '#new-reservation',
    label: 'New booking',
    description: 'Create a reservation',
    icon: <SearchIcon />
  },
  {
    href: '#tables',
    label: 'Tables',
    description: 'Venue table map',
    icon: <GearIcon />
  }
];

type ReservationForm = {
  venue: string;
  serviceDate: string;
  servicePeriod: ReserveServicePeriod;
  time: string;
  durationMinutes: string;
  covers: string;
  tableId: string;
  status: ReserveReservationStatus;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  tags: string;
  allergyNotes: string;
  occasion: string;
  notes: string;
};

type TableForm = {
  venue: string;
  area: string;
  label: string;
  minCovers: string;
  maxCovers: string;
  sortOrder: string;
};

function todayInput() {
  return toDateInput(new Date());
}

function toDateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function dateTime(date: string, time: string) {
  return new Date(`${date}T${time || '18:00'}:00`);
}

function timeOf(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fullName(reservation: ReserveReservation) {
  return `${reservation.guest.firstName} ${reservation.guest.lastName}`.trim();
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

function defaultReservationForm(venue = 'Alma Avalon'): ReservationForm {
  return {
    venue,
    serviceDate: todayInput(),
    servicePeriod: 'DINNER',
    time: '18:30',
    durationMinutes: '120',
    covers: '2',
    tableId: '',
    status: 'CONFIRMED',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    tags: '',
    allergyNotes: '',
    occasion: '',
    notes: ''
  };
}

function defaultTableForm(venue = 'Alma Avalon'): TableForm {
  return {
    venue,
    area: 'Dining room',
    label: '',
    minCovers: '1',
    maxCovers: '4',
    sortOrder: '0'
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeHash, setActiveHash] = useState('#diary');

  useEffect(() => {
    const syncHash = () => setActiveHash(window.location.hash || '#diary');
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  const active = RESERVE_NAV_ITEMS.find((item) => item.href === activeHash) ?? RESERVE_NAV_ITEMS[0]!;

  return (
    <>
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
      <ul
        id="reserve-mobile-nav"
        className={`sidebar-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}
      >
        <li className="sidebar-nav-section">Reserve</li>
        {RESERVE_NAV_ITEMS.map((item) => (
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
    </>
  );
}

function ReserveDashboard({ onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const [venue, setVenue] = useState('Alma Avalon');
  const [selectedDate, setSelectedDate] = useState(todayInput());
  const [data, setData] = useState<ReserveDiarySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [reservationForm, setReservationForm] = useState(() => defaultReservationForm(venue));
  const [tableForm, setTableForm] = useState(() => defaultTableForm(venue));

  const selectedDay = useMemo(() => new Date(`${selectedDate}T00:00:00`), [selectedDate]);
  const start = useMemo(() => selectedDay, [selectedDay]);
  const end = useMemo(() => addDays(selectedDay, 1), [selectedDay]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const query = new URLSearchParams({
        venue,
        start: start.toISOString(),
        end: end.toISOString()
      });
      setData(await api<ReserveDiarySummary>(`/api/reserve/diary?${query.toString()}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load Reserve diary');
    } finally {
      setLoading(false);
    }
  }, [end, start, venue]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setReservationForm((current) => ({ ...current, venue, serviceDate: selectedDate }));
    setTableForm((current) => ({ ...current, venue }));
  }, [selectedDate, venue]);

  const reservations = data?.reservations ?? [];
  const tables = data?.tables ?? [];
  const tableOptions = [
    { label: 'Unassigned', value: '' },
    ...tables.map((table) => ({ label: `${table.label} · ${table.area} · ${table.minCovers}-${table.maxCovers}`, value: table.id }))
  ];
  const reservationsByPeriod = PERIODS.map((period) => ({
    period,
    reservations: reservations.filter((reservation) => reservation.servicePeriod === period)
  }));

  async function saveReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
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
          status: reservationForm.status,
          guest: {
            firstName: reservationForm.firstName,
            lastName: reservationForm.lastName,
            email: reservationForm.email,
            phone: reservationForm.phone,
            tags: reservationForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
            allergyNotes: reservationForm.allergyNotes
          },
          occasion: reservationForm.occasion,
          notes: reservationForm.notes
        })
      });
      setReservationForm(defaultReservationForm(venue));
      setMessage('Reservation saved.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save reservation.');
    }
  }

  async function saveTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
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
      setTableForm(defaultTableForm(venue));
      setMessage('Table saved.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save table.');
    }
  }

  async function updateStatus(reservation: ReserveReservation, status: ReserveReservationStatus) {
    setMessage(null);
    try {
      await api(`/api/reserve/reservations/${reservation.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update reservation.');
    }
  }

  return (
    <AppShell
      brand={<ProductLogo appId="reserve" size="md" showBrandMark={false} />}
      sidebar={<SidebarNav />}
      topBar={
        <TopBar
          title="ALMA Reserve"
          subtitle="Reservations, guests, tables, and covers pacing"
          right={
            <>
              <SuiteAppSwitcher currentApp="reserve" apps={suiteApps} variant="topbar" />
              <Button type="button" variant="secondary" onClick={() => void onLogout()}>Sign out</Button>
            </>
          }
        />
      }
    >
      <div className="reserve-page">
        <PageHeader
          eyebrow="ALMA Reserve"
          title="Booking diary"
          description="Original ALMA reservations software for venues, tables, guest profiles, and covers forecasting."
          actions={
            <>
              <Select label="Venue" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} options={VENUES.map((value) => ({ label: value, value }))} />
              <Input label="Date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.currentTarget.value)} />
              <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>Refresh</Button>
            </>
          }
        />

        {message ? <p className={message.includes('Could') || message.includes('invalid') ? 'error-text' : 'subtle'}>{message}</p> : null}

        <div className="stats-grid">
          <StatCard label="Covers" value={data?.totals.covers ?? 0} hint="Live covers forecast" loading={loading} />
          <StatCard label="Confirmed" value={data?.totals.confirmed ?? 0} hint="Ready for service" loading={loading} />
          <StatCard label="Seated" value={data?.totals.seated ?? 0} hint="Currently in venue" loading={loading} />
          <StatCard label="Tables" value={tables.length} hint="Active table map" loading={loading} />
        </div>

        <div className="reserve-layout">
          <section id="diary" className="reserve-main">
            <Card title={`${venue} diary`} subtitle={`${selectedDay.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`} padding="none">
              {loading ? <Spinner label="Loading diary..." /> : null}
              {!loading && reservations.length === 0 ? (
                <EmptyState title="No bookings yet" description="Create the first reservation for this service day." />
              ) : null}
              <div className="reserve-periods">
                {reservationsByPeriod.map((group) => (
                  <div key={group.period} className="reserve-period">
                    <div className="reserve-period-header">
                      <strong>{group.period}</strong>
                      <Badge tone="neutral">{group.reservations.reduce((sum, reservation) => sum + reservation.covers, 0)} covers</Badge>
                    </div>
                    <div className="reserve-booking-list">
                      {group.reservations.map((reservation) => (
                        <article key={reservation.id} className="reserve-booking">
                          <div>
                            <strong>{timeOf(reservation.startsAt)} · {fullName(reservation)}</strong>
                            <span>{reservation.covers} guests · {reservation.table?.label ?? 'No table'} · {reservation.occasion || 'Standard booking'}</span>
                            {reservation.guest.allergyNotes ? <em>Allergy: {reservation.guest.allergyNotes}</em> : null}
                            {reservation.notes ? <em>{reservation.notes}</em> : null}
                          </div>
                          <div className="reserve-booking-actions">
                            <Badge tone={statusTone(reservation.status)}>{reservation.status.replace('_', ' ')}</Badge>
                            <Select
                              label="Status"
                              value={reservation.status}
                              onChange={(event) => void updateStatus(reservation, event.currentTarget.value as ReserveReservationStatus)}
                              options={STATUSES.map((status) => ({ label: status.replace('_', ' '), value: status }))}
                            />
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          <aside className="reserve-side">
            <div id="new-reservation">
            <Card title="New reservation" subtitle="Create a manager-entered booking. Public widget comes later.">
              <form className="reserve-form" onSubmit={(event) => void saveReservation(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={reservationForm.venue} onChange={(event) => setReservationForm({ ...reservationForm, venue: event.currentTarget.value })} options={VENUES.map((value) => ({ label: value, value }))} />
                  <Select label="Service" value={reservationForm.servicePeriod} onChange={(event) => setReservationForm({ ...reservationForm, servicePeriod: event.currentTarget.value as ReserveServicePeriod })} options={PERIODS.map((value) => ({ label: value, value }))} />
                  <Input label="Date" type="date" value={reservationForm.serviceDate} onChange={(event) => setReservationForm({ ...reservationForm, serviceDate: event.currentTarget.value })} />
                  <Input label="Time" type="time" value={reservationForm.time} onChange={(event) => setReservationForm({ ...reservationForm, time: event.currentTarget.value })} />
                  <Input label="Covers" type="number" min="1" value={reservationForm.covers} onChange={(event) => setReservationForm({ ...reservationForm, covers: event.currentTarget.value })} />
                  <Input label="Duration minutes" type="number" min="30" step="15" value={reservationForm.durationMinutes} onChange={(event) => setReservationForm({ ...reservationForm, durationMinutes: event.currentTarget.value })} />
                  <Select label="Table" value={reservationForm.tableId} onChange={(event) => setReservationForm({ ...reservationForm, tableId: event.currentTarget.value })} options={tableOptions} />
                  <Select label="Status" value={reservationForm.status} onChange={(event) => setReservationForm({ ...reservationForm, status: event.currentTarget.value as ReserveReservationStatus })} options={STATUSES.map((value) => ({ label: value.replace('_', ' '), value }))} />
                  <Input label="First name" required value={reservationForm.firstName} onChange={(event) => setReservationForm({ ...reservationForm, firstName: event.currentTarget.value })} />
                  <Input label="Last name" required value={reservationForm.lastName} onChange={(event) => setReservationForm({ ...reservationForm, lastName: event.currentTarget.value })} />
                  <Input label="Email" type="email" value={reservationForm.email} onChange={(event) => setReservationForm({ ...reservationForm, email: event.currentTarget.value })} />
                  <Input label="Phone" value={reservationForm.phone} onChange={(event) => setReservationForm({ ...reservationForm, phone: event.currentTarget.value })} />
                </div>
                <Input label="Tags" value={reservationForm.tags} onChange={(event) => setReservationForm({ ...reservationForm, tags: event.currentTarget.value })} placeholder="VIP, regular, allergy" />
                <Input label="Occasion" value={reservationForm.occasion} onChange={(event) => setReservationForm({ ...reservationForm, occasion: event.currentTarget.value })} />
                <Textarea label="Allergy notes" rows={2} value={reservationForm.allergyNotes} onChange={(event) => setReservationForm({ ...reservationForm, allergyNotes: event.currentTarget.value })} />
                <Textarea label="Booking notes" rows={2} value={reservationForm.notes} onChange={(event) => setReservationForm({ ...reservationForm, notes: event.currentTarget.value })} />
                <Button type="submit">Save booking</Button>
              </form>
            </Card>
            </div>

            <div id="tables">
            <Card title="Tables" subtitle="Build the table map base for this venue.">
              <form className="reserve-form" onSubmit={(event) => void saveTable(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={tableForm.venue} onChange={(event) => setTableForm({ ...tableForm, venue: event.currentTarget.value })} options={VENUES.map((value) => ({ label: value, value }))} />
                  <Input label="Area" value={tableForm.area} onChange={(event) => setTableForm({ ...tableForm, area: event.currentTarget.value })} />
                  <Input label="Table" required value={tableForm.label} onChange={(event) => setTableForm({ ...tableForm, label: event.currentTarget.value })} />
                  <Input label="Min covers" type="number" min="1" value={tableForm.minCovers} onChange={(event) => setTableForm({ ...tableForm, minCovers: event.currentTarget.value })} />
                  <Input label="Max covers" type="number" min="1" value={tableForm.maxCovers} onChange={(event) => setTableForm({ ...tableForm, maxCovers: event.currentTarget.value })} />
                  <Input label="Sort" type="number" value={tableForm.sortOrder} onChange={(event) => setTableForm({ ...tableForm, sortOrder: event.currentTarget.value })} />
                </div>
                <Button type="submit" variant="secondary">Save table</Button>
              </form>
              <div className="reserve-table-list">
                {tables.map((table) => (
                  <span key={table.id}>{table.label} · {table.area} · {table.minCovers}-{table.maxCovers}</span>
                ))}
              </div>
            </Card>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

export function App() {
  const auth = useReserveAuth();

  if (auth.loading) {
    return (
      <div className="login-page">
        <Spinner label="Checking session" />
      </div>
    );
  }

  if (!auth.user) return <LoginScreen onLogin={auth.login} />;

  return <ReserveDashboard user={auth.user} onLogout={auth.logout} />;
}
