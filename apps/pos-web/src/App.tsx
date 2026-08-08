import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, messageForError } from './api';

// ── ALMA POS v2 ─────────────────────────────────────────────────────────────
// Home screen (open tables/tabs + quick sale + day glance) → order screen
// (menu grid, coursed cart) → charge (tips, cash/card, SPLIT bills). Orders
// are server-backed from the moment a table opens; totals — including the
// automatic weekend/public-holiday surcharge and any timed discounts — are
// computed server-side on every cart change.

type MenuItem = { recipeId: string; title: string; priceCents: number; venue: string | null };
type MenuCategory = { name: string; kind: string; items: MenuItem[] };
type OrderLine = {
  id?: string;
  recipeId: string | null;
  name: string;
  unitPriceCents: number;
  quantity: number;
  course?: string | null;
};
type Payment = { method: string; amountCents: number; tipCents: number; createdAt?: string };
type Order = {
  id: string;
  orderNumber: number;
  venue: string;
  status: 'OPEN' | 'PAID' | 'VOID';
  tableLabel: string | null;
  covers: number | null;
  subtotalCents: number;
  discountCents: number;
  discountLabel: string | null;
  surchargeCents: number;
  surchargeLabel: string | null;
  totalCents: number;
  gstCents: number;
  tipCents: number;
  createdAt: string;
  lines: OrderLine[];
  payments: Payment[];
  changeCents?: number | null;
  balanceCents?: number;
};
type FloorTable = {
  id: string;
  label: string;
  area: string;
  posX: number | null;
  posY: number | null;
  width: number | null;
  height: number | null;
  rotation: number;
  shape: string;
  seats: number | null;
  maxCovers: number;
};
type FloorReservation = {
  id: string;
  name: string;
  covers: number;
  startsAt: string;
  status: string;
  area: string | null;
  tableLabel: string | null;
};
type Docket = {
  profile: string;
  printerIp: string | null;
  tableLabel: string | null;
  orderNumber: number;
  covers: number | null;
  openedByName: string | null;
  lines: Array<{ id: string; name: string; quantity: number; course: string | null; notes: string | null }>;
};
type DrawerInfo = {
  drawer: null | {
    id: string;
    openingFloatCents: number;
    openedAt: string;
    openedByName: string | null;
  };
  expectedCents: number | null;
};
type CloseGate = { openBills: number; drawerOpen: boolean; alreadyClosed: boolean; ready: boolean };
type DaySummary = {
  serviceDate: string;
  orderCount: number;
  totalCents: number;
  gstCents: number;
  tipCents: number;
  methods: Record<string, { count: number; amountCents: number; tipCents: number }>;
  topItems: Array<{ name: string; quantity: number; totalCents: number }>;
};

const VENUES = ['Alma Avalon', 'St Alma', 'Functions / Pop-up'];
const FALLBACK_COURSES = ['Entrée', 'Mains', 'Sides', 'Dessert', 'Drinks'];
// AU cash denominations, cents.
const DENOMS = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5];

function money(cents: number) {
  return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

function paidCents(order: Order) {
  return order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
}

function defaultCourse(kind: string) {
  if (kind === 'BEVERAGE') return 'Drinks';
  if (kind === 'SET_MENU') return 'Mains';
  return 'Mains';
}

function ageMinutes(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

type StaffOption = { id: string; name: string; roleTitle: string; hasPin: boolean };
type AuthShape =
  | 'loading'
  | null
  | { kind: 'staff'; name: string }
  | { kind: 'device'; staffName: string | null; staffList: StaffOption[] };

export function App() {
  const [me, setMe] = useState<AuthShape>('loading');
  const [bill, setBill] = useState<Order | null>(null);
  const [venue, setVenue] = useState<string>(() => localStorage.getItem('alma.pos.venue') ?? VENUES[0]!);
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [kindByRecipe, setKindByRecipe] = useState<Map<string, string>>(new Map());
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [floorTables, setFloorTables] = useState<FloorTable[]>([]);
  const [floorArea, setFloorArea] = useState('');
  const [homeView, setHomeView] = useState<'floor' | 'list'>(() => (localStorage.getItem('alma.pos.view') as 'floor' | 'list') ?? 'floor');
  const [order, setOrder] = useState<Order | null>(null);
  const [activeCategory, setActiveCategory] = useState('');
  const [search, setSearch] = useState('');
  const [newTable, setNewTable] = useState<null | { label: string; covers: string }>(null);
  const [charge, setCharge] = useState<null | { stage: 'tip' | 'method' | 'cash' | 'split'; tipCents: number; amountCents: number | null }>(null);
  const [tendered, setTendered] = useState('');
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [day, setDay] = useState<DaySummary | null>(null);
  const [courses, setCourses] = useState<string[]>(FALLBACK_COURSES);
  const [dockets, setDockets] = useState<Docket[] | null>(null);
  const [reservations, setReservations] = useState<FloorReservation[]>([]);
  const [closing, setClosing] = useState<null | {
    gate: CloseGate | null;
    drawer: DrawerInfo | null;
    stage: 'checklist' | 'count' | 'report';
    float: string;
    counts: Record<number, string>;
    report: (DaySummary & { drawers: Array<{ openingFloatCents: number; expectedCents: number | null; countedCents: number | null; varianceCents: number | null }> }) | null;
  }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await api<{ user: { id: string; firstName?: string; lastName?: string; accountType?: string; deviceAccount?: boolean } | null }>('/api/auth/me');
      const user = res.user;
      if (!user) {
        setMe(null);
        return;
      }
      if (user.accountType === 'VENUE_DEVICE' || user.deviceAccount) {
        // Same PIN flow as Alma Home: the device stays signed in, the human
        // on the register identifies with their PIN.
        const list = await api<{ staff: StaffOption[]; activeUser: { firstName?: string; lastName?: string } | null }>('/api/device/staff');
        const staffName = list.activeUser
          ? `${list.activeUser.firstName ?? ''} ${list.activeUser.lastName ?? ''}`.trim() || null
          : null;
        setMe({ kind: 'device', staffName, staffList: list.staff });
      } else {
        setMe({ kind: 'staff', name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Staff' });
      }
    } catch {
      setMe(null);
    }
  }, []);

  const refreshOpenOrders = useCallback(async () => {
    try {
      setOpenOrders(await api<Order[]>(`/api/pos/orders?venue=${encodeURIComponent(venue)}`));
    } catch {
      /* home refresh is best-effort */
    }
    try {
      const tables = await api<FloorTable[]>(`/api/pos/tables?venue=${encodeURIComponent(venue)}`);
      setFloorTables(tables);
      setFloorArea((current) => current || tables[0]?.area || '');
    } catch {
      /* floor plan is optional */
    }
    try {
      setReservations(await api<FloorReservation[]>(`/api/pos/floor-reservations?venue=${encodeURIComponent(venue)}`));
    } catch {
      /* overlay is optional */
    }
  }, [venue]);

  useEffect(() => {
    localStorage.setItem('alma.pos.view', homeView);
  }, [homeView]);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    localStorage.setItem('alma.pos.venue', venue);
  }, [venue]);

  useEffect(() => {
    if (!me || me === 'loading') return;
    void (async () => {
      try {
        void api<Array<{ name: string }>>('/api/pos/courses')
          .then((rows) => setCourses(rows.map((row) => row.name)))
          .catch(() => undefined);
        const res = await api<{ categories: MenuCategory[] }>('/api/pos/menu');
        setMenu(res.categories);
        setActiveCategory((current) => current || res.categories[0]?.name || '');
        const kinds = new Map<string, string>();
        for (const category of res.categories) for (const item of category.items) kinds.set(item.recipeId, category.kind);
        setKindByRecipe(kinds);
      } catch (err) {
        setError(messageForError(err, 'Could not load the menu.'));
      }
      void refreshOpenOrders();
    })();
  }, [me, refreshOpenOrders]);

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term) return menu.flatMap((category) => category.items).filter((item) => item.title.toLowerCase().includes(term)).slice(0, 60);
    return menu.find((category) => category.name === activeCategory)?.items ?? [];
  }, [menu, activeCategory, search]);

  async function pushLines(next: OrderLine[]) {
    if (!order) return;
    setOrder({ ...order, lines: next });
    try {
      const updated = await api<Order>(`/api/pos/orders/${order.id}/lines`, {
        method: 'PUT',
        body: JSON.stringify({ lines: next })
      });
      setOrder(updated);
    } catch (err) {
      setError(messageForError(err, 'Could not save the order.'));
      try {
        setOrder(await api<Order>(`/api/pos/orders/${order.id}`));
      } catch {
        /* keep local state */
      }
    }
  }

  function addItem(item: MenuItem) {
    if (!order) return;
    const existing = order.lines.find((line) => line.recipeId === item.recipeId);
    const next = existing
      ? order.lines.map((line) => (line.recipeId === item.recipeId ? { ...line, quantity: line.quantity + 1 } : line))
      : [
          ...order.lines,
          {
            recipeId: item.recipeId,
            name: item.title,
            unitPriceCents: item.priceCents,
            quantity: 1,
            course: defaultCourse(kindByRecipe.get(item.recipeId) ?? 'FOOD')
          }
        ];
    void pushLines(next);
  }

  function bumpQty(index: number, delta: number) {
    if (!order) return;
    const next = order.lines
      .map((line, i) => (i === index ? { ...line, quantity: line.quantity + delta } : line))
      .filter((line) => line.quantity > 0);
    void pushLines(next);
  }

  function cycleCourse(index: number) {
    if (!order) return;
    const next = order.lines.map((line, i) => {
      if (i !== index) return line;
      const at = courses.indexOf(line.course ?? 'Mains');
      return { ...line, course: courses[(at + 1) % courses.length] };
    });
    void pushLines(next);
  }

  async function openOrder(input: { tableLabel?: string; covers?: number }) {
    setBusy(true);
    setError(null);
    try {
      const created = await api<Order>('/api/pos/orders', {
        method: 'POST',
        body: JSON.stringify({ venue, openedByName: operatorName || undefined, ...input })
      });
      setOrder(created);
      setNewTable(null);
    } catch (err) {
      setError(messageForError(err, 'Could not open the order.'));
    } finally {
      setBusy(false);
    }
  }

  async function takePayment(method: 'CASH' | 'CARD_EXTERNAL') {
    if (!order || !charge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const tenderedCents = method === 'CASH' ? Math.round(Number(tendered || '0') * 100) || undefined : undefined;
      const result = await api<Order>(`/api/pos/orders/${order.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          method,
          tipCents: charge.tipCents,
          amountCents: charge.amountCents,
          tenderedCents
        })
      });
      setTendered('');
      if (result.status === 'PAID') {
        setReceipt(result);
        setOrder(null);
        setCharge(null);
        void refreshOpenOrders();
      } else {
        setOrder(result);
        setCharge({ stage: 'split', tipCents: 0, amountCents: null });
      }
    } catch (err) {
      setError(messageForError(err, 'Payment could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  async function openDay() {
    try {
      setDay(await api<DaySummary>(`/api/pos/day-summary?venue=${encodeURIComponent(venue)}`));
    } catch (err) {
      setError(messageForError(err, 'Could not load the day summary.'));
    }
  }

  if (me === 'loading') return <div className="pos-center">Loading…</div>;
  if (!me) return <SignIn onSignedIn={refreshAuth} />;
  if (me.kind === 'device' && !me.staffName) {
    return <PinScreen staffList={me.staffList} onSignedIn={refreshAuth} />;
  }

  const operatorName = me.kind === 'staff' ? me.name : me.staffName ?? '';
  const balance = order ? order.totalCents - paidCents(order) : 0;

  return (
    <div className="pos-shell">
      <header className="pos-header">
        <strong onClick={() => { setOrder(null); void refreshOpenOrders(); }} style={{ cursor: 'pointer' }}>
          ALMA POS
        </strong>
        {order ? (
          <span className="pos-crumb">
            {order.tableLabel ? `Table ${order.tableLabel}` : `Sale #${order.orderNumber}`}
            {order.covers ? ` · ${order.covers} covers` : ''}
          </span>
        ) : (
          <select value={venue} onChange={(event) => setVenue(event.currentTarget.value)}>
            {VENUES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        )}
        {order ? (
          <input className="pos-search" placeholder="Search menu…" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
        ) : null}
        <span style={{ flex: 1 }} />
        {operatorName ? (
          <button
            type="button"
            className="pos-staff-chip"
            title="Switch staff"
            onClick={() => {
              if (me.kind !== 'device') return;
              void api('/api/device/pin-logout', { method: 'POST' })
                .catch(() => undefined)
                .then(() => refreshAuth());
            }}
          >
            {operatorName}
            {me.kind === 'device' ? ' · switch' : ''}
          </button>
        ) : null}
        {order ? (
          <>
            <button
              type="button"
              className="pos-ghost"
              disabled={busy || order.lines.every((line) => (line as { sentAt?: string | null }).sentAt)}
              onClick={() => {
                void api<{ dockets: Docket[]; sent: number }>(`/api/pos/orders/${order.id}/send`, { method: 'POST' })
                  .then(async (result) => {
                    if (result.dockets.length > 0) setDockets(result.dockets);
                    setOrder(await api<Order>(`/api/pos/orders/${order.id}`));
                  })
                  .catch((err) => setError(messageForError(err, 'Could not send the order.')));
              }}
            >
              Send
            </button>
            <button type="button" className="pos-ghost" disabled={order.lines.length === 0} onClick={() => setBill(order)}>
              Bill
            </button>
            <button type="button" className="pos-ghost" onClick={() => { setOrder(null); void refreshOpenOrders(); }}>
              Tables
            </button>
          </>
        ) : (
          <>
            <button type="button" className="pos-ghost" onClick={() => void openDay()}>
              Day
            </button>
            <button
              type="button"
              className="pos-ghost"
              onClick={() => {
                void (async () => {
                  const [gate, drawer] = await Promise.all([
                    api<CloseGate>(`/api/pos/close-day?venue=${encodeURIComponent(venue)}`),
                    api<DrawerInfo>(`/api/pos/drawer?venue=${encodeURIComponent(venue)}`)
                  ]);
                  setClosing({ gate, drawer, stage: 'checklist', float: '', counts: {}, report: null });
                })().catch((err) => setError(messageForError(err, 'Could not load close of day.')));
              }}
            >
              Close
            </button>
          </>
        )}
      </header>

      {error ? (
        <div className="pos-error" onClick={() => setError(null)}>
          {error} — tap to dismiss
        </div>
      ) : null}

      {!order ? (
        <div className="pos-home">
          <div className="pos-home-actions">
            <button type="button" className="pos-home-new" onClick={() => setNewTable({ label: '', covers: '' })}>
              + New table
            </button>
            <button type="button" className="pos-home-new pos-home-quick" disabled={busy} onClick={() => void openOrder({})}>
              Quick sale
            </button>
            {floorTables.length > 0 ? (
              <button
                type="button"
                className="pos-home-new pos-home-quick pos-view-toggle"
                onClick={() => setHomeView(homeView === 'floor' ? 'list' : 'floor')}
              >
                {homeView === 'floor' ? 'List view' : 'Floor view'}
              </button>
            ) : null}
          </div>
          {homeView === 'floor' && floorTables.length > 0 ? (
            <FloorView
              tables={floorTables}
              area={floorArea}
              setArea={setFloorArea}
              openOrders={openOrders}
              reservations={reservations}
              busy={busy}
              onPick={(table) => {
                const existing = openOrders.find(
                  (open) => (open.tableLabel ?? '').toLowerCase() === table.label.toLowerCase()
                );
                if (existing) setOrder(existing);
                else void openOrder({ tableLabel: table.label, covers: table.seats ?? undefined });
              }}
            />
          ) : null}
          {homeView === 'floor' && floorTables.length > 0 ? null : null}
          <div className="pos-home-grid" style={homeView === 'floor' && floorTables.length > 0 ? { display: 'none' } : undefined}>
            {openOrders.map((open) => (
              <button key={open.id} type="button" className="pos-table-card" onClick={() => setOrder(open)}>
                <strong>{open.tableLabel ? `Table ${open.tableLabel}` : `#${open.orderNumber}`}</strong>
                <span className="pos-muted">
                  {open.covers ? `${open.covers} covers · ` : ''}
                  {ageMinutes(open.createdAt)}m
                </span>
                <span className="pos-table-total">
                  {money(open.totalCents)}
                  {paidCents(open) > 0 ? <small> ({money(open.totalCents - paidCents(open))} owing)</small> : null}
                </span>
              </button>
            ))}
            {openOrders.length === 0 ? <p className="pos-muted">No open tables at {venue}.</p> : null}
          </div>
        </div>
      ) : (
        <div className="pos-body">
          <div className="pos-menu">
            {!search ? (
              <nav className="pos-tabs">
                {menu.map((category) => (
                  <button
                    key={category.name}
                    type="button"
                    className={category.name === activeCategory ? 'is-active' : ''}
                    onClick={() => setActiveCategory(category.name)}
                  >
                    {category.name}
                  </button>
                ))}
              </nav>
            ) : null}
            <div className="pos-grid">
              {visibleItems.map((item) => (
                <button key={item.recipeId} type="button" className="pos-item" onClick={() => addItem(item)}>
                  <span>{item.title}</span>
                  <small>{money(item.priceCents)}</small>
                </button>
              ))}
              {visibleItems.length === 0 ? <p className="pos-muted">No items{search ? ' match' : ''}.</p> : null}
            </div>
          </div>

          <aside className="pos-cart">
            <div className="pos-cart-lines">
              {order.lines.length === 0 ? <p className="pos-muted">Tap items to add them.</p> : null}
              {order.lines.map((line, index) => (
                <div key={`${line.recipeId}-${index}`} className="pos-line">
                  <span className="pos-line-main">
                    <span className="pos-line-name">{line.name}</span>
                    <button type="button" className="pos-course" onClick={() => cycleCourse(index)}>
                      {line.course ?? 'Mains'}
                    </button>
                  </span>
                  <span className="pos-stepper">
                    <button type="button" onClick={() => bumpQty(index, -1)}>−</button>
                    <b>{line.quantity}</b>
                    <button type="button" onClick={() => bumpQty(index, 1)}>+</button>
                  </span>
                  <span className="pos-line-total">{money(line.unitPriceCents * line.quantity)}</span>
                </div>
              ))}
            </div>
            <div className="pos-cart-foot">
              <div className="pos-sumline">
                <span>Subtotal</span>
                <span>{money(order.subtotalCents)}</span>
              </div>
              {order.discountCents > 0 ? (
                <div className="pos-sumline pos-sumline-good">
                  <span>{order.discountLabel ?? 'Discount'}</span>
                  <span>−{money(order.discountCents)}</span>
                </div>
              ) : null}
              {order.surchargeCents > 0 ? (
                <div className="pos-sumline">
                  <span>{order.surchargeLabel ?? 'Surcharge'}</span>
                  <span>+{money(order.surchargeCents)}</span>
                </div>
              ) : null}
              {paidCents(order) > 0 ? (
                <div className="pos-sumline pos-sumline-good">
                  <span>Paid so far</span>
                  <span>−{money(paidCents(order))}</span>
                </div>
              ) : null}
              <div className="pos-totals">
                <span>{paidCents(order) > 0 ? 'Balance' : 'Total'} (incl. GST {money(order.gstCents)})</span>
                <strong>{money(balance)}</strong>
              </div>
              <div className="pos-cart-actions">
                <button
                  type="button"
                  className="pos-ghost"
                  disabled={busy || order.lines.length === 0 || paidCents(order) > 0}
                  onClick={() => {
                    void api(`/api/pos/orders/${order.id}/void`, { method: 'POST', body: JSON.stringify({ reason: 'register' }) })
                      .then(() => {
                        setOrder(null);
                        void refreshOpenOrders();
                      })
                      .catch((err) => setError(messageForError(err, 'Could not void.')));
                  }}
                >
                  Void
                </button>
                <button
                  type="button"
                  className="pos-charge"
                  disabled={order.lines.length === 0 || busy || balance <= 0}
                  onClick={() => setCharge({ stage: 'tip', tipCents: 0, amountCents: null })}
                >
                  Charge {money(balance)}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {newTable ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            <h2>New table</h2>
            <input
              className="pos-tender"
              placeholder="Table (e.g. 12, Bar 2)"
              value={newTable.label}
              onChange={(event) => setNewTable({ ...newTable, label: event.currentTarget.value })}
            />
            <input
              className="pos-tender"
              inputMode="numeric"
              placeholder="Covers (optional)"
              value={newTable.covers}
              onChange={(event) => setNewTable({ ...newTable, covers: event.currentTarget.value })}
            />
            <button
              type="button"
              className="pos-charge"
              disabled={busy || !newTable.label.trim()}
              onClick={() =>
                void openOrder({
                  tableLabel: newTable.label.trim(),
                  covers: newTable.covers.trim() ? Number(newTable.covers) : undefined
                })
              }
            >
              Open table
            </button>
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setNewTable(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {charge && order ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel">
            {charge.stage === 'tip' ? (
              <>
                <h2>Add a tip?</h2>
                <div className="pos-choice-row">
                  {[0, 5, 10].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setCharge({ stage: 'split', tipCents: Math.round((balance * pct) / 100), amountCents: null })}
                    >
                      {pct === 0 ? 'No tip' : `+${pct}% (${money(Math.round((balance * pct) / 100))})`}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {charge.stage === 'split' ? (
              <>
                <h2>{money(balance + charge.tipCents)}</h2>
                {charge.tipCents > 0 ? <p className="pos-muted">includes {money(charge.tipCents)} tip on this payment</p> : null}
                <div className="pos-choice-row">
                  <button type="button" onClick={() => setCharge({ ...charge, stage: 'method', amountCents: null })}>
                    Pay in full
                  </button>
                  {[2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCharge({ ...charge, stage: 'method', amountCents: Math.ceil(balance / n) })}
                    >
                      Split ÷{n} ({money(Math.ceil(balance / n))})
                    </button>
                  ))}
                </div>
                <input
                  className="pos-tender"
                  inputMode="decimal"
                  placeholder="Or custom amount"
                  value={charge.amountCents === null ? '' : String(charge.amountCents / 100)}
                  onChange={(event) => {
                    const cents = Math.round(Number(event.currentTarget.value || '0') * 100);
                    setCharge({ ...charge, amountCents: cents > 0 ? Math.min(cents, balance) : null });
                  }}
                />
                {charge.amountCents !== null ? (
                  <button type="button" className="pos-charge" onClick={() => setCharge({ ...charge, stage: 'method' })}>
                    Take {money(charge.amountCents + charge.tipCents)}
                  </button>
                ) : null}
              </>
            ) : null}
            {charge.stage === 'method' ? (
              <>
                <h2>{money((charge.amountCents ?? balance) + charge.tipCents)}</h2>
                <div className="pos-choice-row">
                  <button type="button" disabled={busy} onClick={() => void takePayment('CARD_EXTERNAL')}>
                    Card (terminal)
                  </button>
                  <button type="button" disabled={busy} onClick={() => setCharge({ ...charge, stage: 'cash' })}>
                    Cash
                  </button>
                </div>
              </>
            ) : null}
            {charge.stage === 'cash' ? (
              <CashPad
                dueCents={(charge.amountCents ?? balance) + charge.tipCents}
                tendered={tendered}
                setTendered={setTendered}
                busy={busy}
                onTake={() => void takePayment('CASH')}
              />
            ) : null}
            <button type="button" className="pos-ghost pos-modal-close" disabled={busy} onClick={() => { setCharge(null); setTendered(''); }}>
              Back to order
            </button>
          </div>
        </div>
      ) : null}

      {bill ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel pos-receipt" id="pos-bill">
            <div className="pos-bill-head">
              <h2>ALMA</h2>
              <p className="pos-muted">
                {bill.venue}
                <br />
                {bill.tableLabel ? `Table ${bill.tableLabel}` : `Order #${bill.orderNumber}`}
                {bill.covers ? ` · ${bill.covers} guests` : ''}
                <br />
                {new Date().toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </div>
            <div className="pos-receipt-lines">
              {bill.lines.map((line, index) => (
                <div key={index}>
                  <span>
                    {line.quantity}× {line.name}
                  </span>
                  <span>{money(line.unitPriceCents * line.quantity)}</span>
                </div>
              ))}
              {bill.discountCents > 0 ? (
                <div>
                  <span>{bill.discountLabel ?? 'Discount'}</span>
                  <span>−{money(bill.discountCents)}</span>
                </div>
              ) : null}
              {bill.surchargeCents > 0 ? (
                <div>
                  <span>{bill.surchargeLabel ?? 'Surcharge'}</span>
                  <span>+{money(bill.surchargeCents)}</span>
                </div>
              ) : null}
              {paidCents(bill) > 0 ? (
                <div>
                  <span>Paid so far</span>
                  <span>−{money(paidCents(bill))}</span>
                </div>
              ) : null}
              <div className="pos-receipt-total">
                <span>Total due (incl. {money(bill.gstCents)} GST)</span>
                <span>{money(bill.totalCents - paidCents(bill))}</span>
              </div>
            </div>
            <p className="pos-muted pos-bill-foot">Thank you — pay at the counter or with your server.</p>
            <div className="pos-choice-row">
              <button type="button" className="pos-ghost" onClick={() => setBill(null)}>
                Close
              </button>
              <button type="button" className="pos-charge" onClick={() => window.print()}>
                Print bill
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {receipt ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel pos-receipt" id="pos-receipt">
            <h2>
              Paid — {receipt.tableLabel ? `Table ${receipt.tableLabel}` : `order #${receipt.orderNumber}`}
            </h2>
            {receipt.changeCents ? <p className="pos-change">Change due: {money(receipt.changeCents)}</p> : null}
            <div className="pos-receipt-lines">
              {receipt.lines.map((line, index) => (
                <div key={index}>
                  <span>
                    {line.quantity}× {line.name}
                  </span>
                  <span>{money(line.unitPriceCents * line.quantity)}</span>
                </div>
              ))}
              {receipt.discountCents > 0 ? (
                <div>
                  <span>{receipt.discountLabel ?? 'Discount'}</span>
                  <span>−{money(receipt.discountCents)}</span>
                </div>
              ) : null}
              {receipt.surchargeCents > 0 ? (
                <div>
                  <span>{receipt.surchargeLabel ?? 'Surcharge'}</span>
                  <span>+{money(receipt.surchargeCents)}</span>
                </div>
              ) : null}
              {receipt.payments.length > 1
                ? receipt.payments.map((payment, index) => (
                    <div key={`p-${index}`}>
                      <span>
                        {payment.method === 'CASH' ? 'Cash' : 'Card'} payment {index + 1}
                      </span>
                      <span>{money(payment.amountCents + payment.tipCents)}</span>
                    </div>
                  ))
                : null}
              <div className="pos-receipt-total">
                <span>
                  Total (incl. {money(receipt.gstCents)} GST{receipt.tipCents ? ` + ${money(receipt.tipCents)} tips` : ''})
                </span>
                <span>{money(receipt.totalCents + receipt.tipCents)}</span>
              </div>
            </div>
            <div className="pos-choice-row">
              <button type="button" className="pos-ghost" onClick={() => window.print()}>
                Print receipt
              </button>
              <button type="button" className="pos-charge" onClick={() => setReceipt(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dockets ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel pos-receipt" id="pos-docket">
            {dockets.map((docket, index) => (
              <div key={index} className="pos-docket">
                <div className="pos-docket-head">
                  <h2>{docket.profile}</h2>
                  <p className="pos-muted">
                    {docket.tableLabel ? `Table ${docket.tableLabel}` : `Order #${docket.orderNumber}`}
                    {docket.covers ? ` · ${docket.covers} covers` : ''}
                    {docket.openedByName ? ` · ${docket.openedByName}` : ''}
                  </p>
                </div>
                {docket.lines.map((line) => (
                  <div key={line.id} className="pos-docket-line">
                    <strong>
                      {line.quantity}× {line.name}
                    </strong>
                    <small>
                      {line.course ?? ''}
                      {line.notes ? ` — ${line.notes}` : ''}
                    </small>
                  </div>
                ))}
              </div>
            ))}
            <div className="pos-choice-row">
              <button type="button" className="pos-ghost" onClick={() => window.print()}>
                Print dockets
              </button>
              <button type="button" className="pos-charge" onClick={() => setDockets(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {closing ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel pos-receipt" id="pos-close">
            {closing.stage === 'checklist' ? (
              <>
                <h2>Close of day — {venue}</h2>
                <div className="pos-checklist">
                  <div className={closing.gate && closing.gate.openBills === 0 ? 'is-ok' : 'is-block'}>
                    {closing.gate?.openBills === 0 ? '✓' : '✕'} All bills closed
                    {closing.gate && closing.gate.openBills > 0 ? ` — ${closing.gate.openBills} still open` : ''}
                  </div>
                  <div className={closing.drawer?.drawer ? 'is-block' : 'is-ok'}>
                    {closing.drawer?.drawer ? '✕ Cash drawer open — count it below' : '✓ Cash drawer closed'}
                  </div>
                  {closing.gate?.alreadyClosed ? <div className="is-block">✕ Already closed today</div> : null}
                </div>

                {!closing.drawer?.drawer ? (
                  <div className="pos-drawer-open">
                    <p className="pos-muted">No drawer open. Start one with an opening float:</p>
                    <input
                      className="pos-tender"
                      inputMode="decimal"
                      placeholder="Opening float (e.g. 300)"
                      value={closing.float}
                      onChange={(event) => setClosing({ ...closing, float: event.currentTarget.value })}
                    />
                    <button
                      type="button"
                      className="pos-ghost"
                      disabled={busy || !closing.float}
                      onClick={() => {
                        void api<DrawerInfo['drawer']>('/api/pos/drawer/open', {
                          method: 'POST',
                          body: JSON.stringify({
                            venue,
                            openingFloatCents: Math.round(Number(closing.float) * 100),
                            openedByName: operatorName
                          })
                        })
                          .then(async () => {
                            const drawer = await api<DrawerInfo>(`/api/pos/drawer?venue=${encodeURIComponent(venue)}`);
                            setClosing({ ...closing, drawer, float: '' });
                          })
                          .catch((err) => setError(messageForError(err, 'Could not open the drawer.')));
                      }}
                    >
                      Open drawer
                    </button>
                  </div>
                ) : (
                  <button type="button" className="pos-ghost" onClick={() => setClosing({ ...closing, stage: 'count' })}>
                    Count &amp; close drawer → (expecting {money(closing.drawer.expectedCents ?? 0)})
                  </button>
                )}

                <button
                  type="button"
                  className="pos-charge"
                  disabled={busy || !closing.gate?.ready}
                  onClick={() => {
                    void api<NonNullable<typeof closing.report>>('/api/pos/close-day', {
                      method: 'POST',
                      body: JSON.stringify({ venue, closedByName: operatorName })
                    })
                      .then((report) => setClosing({ ...closing, stage: 'report', report }))
                      .catch((err) => setError(messageForError(err, 'Close of day failed.')));
                  }}
                >
                  Run close of day
                </button>
              </>
            ) : null}

            {closing.stage === 'count' && closing.drawer?.drawer ? (
              <>
                <h2>Count the till</h2>
                <p className="pos-muted">
                  Float {money(closing.drawer.drawer.openingFloatCents)} · expecting {money(closing.drawer.expectedCents ?? 0)}
                </p>
                <div className="pos-denoms">
                  {DENOMS.map((denomination) => (
                    <label key={denomination}>
                      <span>{denomination >= 500 ? `$${denomination / 100}` : `${denomination}c`}</span>
                      <input
                        inputMode="numeric"
                        placeholder="0"
                        value={closing.counts[denomination] ?? ''}
                        onChange={(event) =>
                          setClosing({
                            ...closing,
                            counts: { ...closing.counts, [denomination]: event.currentTarget.value }
                          })
                        }
                      />
                      <small>
                        {money(denomination * (Number(closing.counts[denomination] ?? '0') || 0))}
                      </small>
                    </label>
                  ))}
                </div>
                {(() => {
                  const counted = DENOMS.reduce(
                    (sum, denomination) => sum + denomination * (Number(closing.counts[denomination] ?? '0') || 0),
                    0
                  );
                  const expected = closing.drawer?.expectedCents ?? 0;
                  const variance = counted - expected;
                  return (
                    <div className="pos-count-summary">
                      <div>
                        <span>Counted</span>
                        <strong>{money(counted)}</strong>
                      </div>
                      <div>
                        <span>Expected</span>
                        <strong>{money(expected)}</strong>
                      </div>
                      <div className={variance === 0 ? '' : variance > 0 ? 'is-over' : 'is-short'}>
                        <span>{variance === 0 ? 'Balanced' : variance > 0 ? 'Over' : 'Short'}</span>
                        <strong>{money(Math.abs(variance))}</strong>
                      </div>
                    </div>
                  );
                })()}
                <button
                  type="button"
                  className="pos-charge"
                  disabled={busy}
                  onClick={() => {
                    const denominations = Object.fromEntries(
                      DENOMS.map((denomination) => [denomination, Number(closing.counts[denomination] ?? '0') || 0])
                    );
                    void api('/api/pos/drawer/close', {
                      method: 'POST',
                      body: JSON.stringify({ venue, denominations, closedByName: operatorName })
                    })
                      .then(async () => {
                        const [gate, drawer] = await Promise.all([
                          api<CloseGate>(`/api/pos/close-day?venue=${encodeURIComponent(venue)}`),
                          api<DrawerInfo>(`/api/pos/drawer?venue=${encodeURIComponent(venue)}`)
                        ]);
                        setClosing({ ...closing, gate, drawer, stage: 'checklist', counts: {} });
                      })
                      .catch((err) => setError(messageForError(err, 'Could not close the drawer.')));
                  }}
                >
                  Close drawer
                </button>
                <button type="button" className="pos-ghost" onClick={() => setClosing({ ...closing, stage: 'checklist' })}>
                  Back
                </button>
              </>
            ) : null}

            {closing.stage === 'report' && closing.report ? (
              <>
                <h2>Close of day — {closing.report.serviceDate}</h2>
                <div className="pos-day-grid">
                  <div>
                    <small>Sales</small>
                    <strong>{money(closing.report.totalCents)}</strong>
                  </div>
                  <div>
                    <small>Orders</small>
                    <strong>{closing.report.orderCount}</strong>
                  </div>
                  <div>
                    <small>Tips</small>
                    <strong>{money(closing.report.tipCents)}</strong>
                  </div>
                  <div>
                    <small>GST</small>
                    <strong>{money(closing.report.gstCents)}</strong>
                  </div>
                </div>
                {Object.entries(closing.report.methods).map(([method, bucket]) => (
                  <p key={method} className="pos-muted">
                    {method === 'CASH' ? 'Cash' : 'Card'} · {bucket.count} payments · {money(bucket.amountCents + bucket.tipCents)}
                  </p>
                ))}
                {closing.report.drawers.map((drawer, index) => (
                  <p key={index} className="pos-muted">
                    Drawer {index + 1}: float {money(drawer.openingFloatCents)} → counted {money(drawer.countedCents ?? 0)} (
                    {(drawer.varianceCents ?? 0) === 0
                      ? 'balanced'
                      : `${(drawer.varianceCents ?? 0) > 0 ? 'over' : 'short'} ${money(Math.abs(drawer.varianceCents ?? 0))}`}
                    )
                  </p>
                ))}
                {closing.report.topItems.slice(0, 10).map((item) => (
                  <div key={item.name} className="pos-day-item">
                    <span>
                      {item.quantity}× {item.name}
                    </span>
                    <span>{money(item.totalCents)}</span>
                  </div>
                ))}
                <div className="pos-choice-row">
                  <button type="button" className="pos-ghost" onClick={() => window.print()}>
                    Print report
                  </button>
                  <button type="button" className="pos-charge" onClick={() => setClosing(null)}>
                    Done
                  </button>
                </div>
              </>
            ) : null}
            {closing.stage !== 'report' ? (
              <button type="button" className="pos-ghost pos-modal-close" onClick={() => setClosing(null)}>
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {day ? (
        <div className="pos-modal" role="dialog" onClick={() => setDay(null)}>
          <div className="pos-modal-panel" onClick={(event) => event.stopPropagation()}>
            <h2>
              {venue} · {day.serviceDate}
            </h2>
            <div className="pos-day-grid">
              <div>
                <small>Sales</small>
                <strong>{money(day.totalCents)}</strong>
              </div>
              <div>
                <small>Orders</small>
                <strong>{day.orderCount}</strong>
              </div>
              <div>
                <small>Tips</small>
                <strong>{money(day.tipCents)}</strong>
              </div>
              <div>
                <small>GST</small>
                <strong>{money(day.gstCents)}</strong>
              </div>
            </div>
            {Object.entries(day.methods).map(([method, bucket]) => (
              <p key={method} className="pos-muted">
                {method === 'CASH' ? 'Cash' : 'Card'} · {bucket.count} payments · {money(bucket.amountCents + bucket.tipCents)}
              </p>
            ))}
            {day.topItems.slice(0, 8).map((item) => (
              <div key={item.name} className="pos-day-item">
                <span>
                  {item.quantity}× {item.name}
                </span>
                <span>{money(item.totalCents)}</span>
              </div>
            ))}
            <button type="button" className="pos-ghost pos-modal-close" onClick={() => setDay(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// The venue floor plan — same tables + geometry the Reserve app's floor-plan
// editor manages. Occupied = an open POS order whose table label matches.
function FloorView({
  tables,
  area,
  setArea,
  openOrders,
  reservations,
  busy,
  onPick
}: {
  tables: FloorTable[];
  area: string;
  setArea: (value: string) => void;
  openOrders: Order[];
  reservations: FloorReservation[];
  busy: boolean;
  onPick: (table: FloorTable) => void;
}) {
  const now = Date.now();
  // Next upcoming (or currently seated) booking per table label.
  const nextByTable = new Map<string, FloorReservation>();
  for (const reservation of reservations) {
    if (!reservation.tableLabel) continue;
    if (new Date(reservation.startsAt).getTime() < now - 2.5 * 3600_000) continue;
    const key = reservation.tableLabel.toLowerCase();
    if (!nextByTable.has(key)) nextByTable.set(key, reservation);
  }
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' });
  const areas = Array.from(new Set(tables.map((table) => table.area)));
  const shown = tables.filter((table) => table.area === (area || areas[0]));
  const placed = shown.filter((table) => table.posX != null && table.posY != null);
  const unplaced = shown.filter((table) => table.posX == null || table.posY == null);
  const orderFor = (table: FloorTable) =>
    openOrders.find((open) => (open.tableLabel ?? '').toLowerCase() === table.label.toLowerCase());

  return (
    <div className="pos-floor">
      {areas.length > 1 ? (
        <nav className="pos-tabs">
          {areas.map((name) => (
            <button key={name} type="button" className={name === (area || areas[0]) ? 'is-active' : ''} onClick={() => setArea(name)}>
              {name}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="pos-floor-canvas">
        {placed.map((table) => {
          const open = orderFor(table);
          return (
            <button
              key={table.id}
              type="button"
              disabled={busy}
              className={`pos-floor-table ${open ? 'is-occupied' : ''} ${!open && nextByTable.has(table.label.toLowerCase()) ? 'is-reserved' : ''} ${table.shape === 'round' ? 'is-round' : ''}`}
              style={{
                left: `${table.posX}%`,
                top: `${table.posY}%`,
                width: `${table.width ?? 10}%`,
                height: `${table.height ?? 10}%`,
                transform: `rotate(${table.rotation}deg)`
              }}
              onClick={() => onPick(table)}
            >
              <strong>{table.label}</strong>
              <small>
                {open
                  ? money(open.totalCents - paidCents(open))
                  : (() => {
                      const upcoming = nextByTable.get(table.label.toLowerCase());
                      return upcoming
                        ? `${timeOf(upcoming.startsAt)} ${upcoming.name.split(' ')[0]} ×${upcoming.covers}`
                        : `${table.seats ?? table.maxCovers}`;
                    })()}
              </small>
            </button>
          );
        })}
        {placed.length === 0 ? (
          <p className="pos-muted pos-floor-empty">
            No tables placed for this area yet — arrange them in Reserve → Settings → Floor plan and they appear here.
          </p>
        ) : null}
      </div>
      {unplaced.length > 0 ? (
        <div className="pos-floor-unplaced">
          {unplaced.map((table) => {
            const open = orderFor(table);
            return (
              <button key={table.id} type="button" disabled={busy} className={`pos-ghost ${open ? 'pos-chip-occupied' : ''}`} onClick={() => onPick(table)}>
                {table.label}
                {open ? ` · ${money(open.totalCents - paidCents(open))}` : ''}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function CashPad({
  dueCents,
  tendered,
  setTendered,
  busy,
  onTake
}: {
  dueCents: number;
  tendered: string;
  setTendered: (value: string) => void;
  busy: boolean;
  onTake: () => void;
}) {
  const tenderedCents = Math.round(Number(tendered || '0') * 100);
  return (
    <>
      <h2>Cash — {money(dueCents)}</h2>
      <div className="pos-choice-row">
        {[dueCents, Math.ceil(dueCents / 5000) * 5000, Math.ceil(dueCents / 10000) * 10000]
          .filter((value, index, all) => all.indexOf(value) === index)
          .map((cents) => (
            <button key={cents} type="button" onClick={() => setTendered(String(cents / 100))}>
              {money(cents)}
            </button>
          ))}
      </div>
      <input
        className="pos-tender"
        inputMode="decimal"
        placeholder="Tendered"
        value={tendered}
        onChange={(event) => setTendered(event.currentTarget.value)}
      />
      {tendered && tenderedCents >= dueCents ? <p className="pos-change">Change: {money(tenderedCents - dueCents)}</p> : null}
      <button type="button" className="pos-charge" disabled={busy || !tendered || tenderedCents < dueCents} onClick={onTake}>
        Take cash
      </button>
    </>
  );
}

function PinScreen({ staffList, onSignedIn }: { staffList: StaffOption[]; onSignedIn: () => Promise<void> }) {
  const [selected, setSelected] = useState<StaffOption | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitPin(nextPin: string) {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/device/pin-login', {
        method: 'POST',
        body: JSON.stringify({ staffProfileId: selected.id, pin: nextPin })
      });
      await onSignedIn();
    } catch (err) {
      setError(messageForError(err, 'Wrong PIN.'));
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  function press(digit: string) {
    if (busy) return;
    const next = (pin + digit).slice(0, 6);
    setPin(next);
    if (next.length >= 4) void submitPin(next);
  }

  return (
    <div className="pos-center">
      <div className="pos-pin">
        <h1>Who's on the register?</h1>
        {!selected ? (
          <div className="pos-pin-staff">
            {staffList.filter((member) => member.hasPin).map((member) => (
              <button key={member.id} type="button" onClick={() => setSelected(member)}>
                <strong>{member.name}</strong>
                <small>{member.roleTitle}</small>
              </button>
            ))}
            {staffList.filter((member) => member.hasPin).length === 0 ? (
              <p className="pos-muted">No staff have PINs yet — set them in the Staff app.</p>
            ) : null}
          </div>
        ) : (
          <>
            <p className="pos-muted">
              {selected.name} — enter your PIN{' '}
              <button type="button" className="pos-linklike" onClick={() => { setSelected(null); setPin(''); setError(null); }}>
                (change)
              </button>
            </p>
            <div className="pos-pin-dots">{'●'.repeat(pin.length).padEnd(4, '○')}</div>
            {error ? <p className="pos-error-inline">{error}</p> : null}
            <div className="pos-pin-pad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, index) =>
                key === '' ? (
                  <span key={index} />
                ) : (
                  <button
                    key={index}
                    type="button"
                    disabled={busy}
                    onClick={() => (key === '⌫' ? setPin(pin.slice(0, -1)) : press(key))}
                  >
                    {key}
                  </button>
                )
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      await onSignedIn();
    } catch (err) {
      setError(messageForError(err, 'Sign in failed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pos-center">
      <form className="pos-signin" onSubmit={submit}>
        <h1>ALMA POS</h1>
        <p className="pos-muted">Sign in with the venue device account (or any staff login).</p>
        <input type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} required />
        {error ? <p className="pos-error-inline">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Open register'}
        </button>
      </form>
    </div>
  );
}
