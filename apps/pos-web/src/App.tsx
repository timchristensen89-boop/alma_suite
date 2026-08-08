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
const COURSES = ['Mains', 'Entrée', 'Sides', 'Dessert', 'Drinks'];

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

export function App() {
  const [me, setMe] = useState<{ id: string } | null | 'loading'>('loading');
  const [venue, setVenue] = useState<string>(() => localStorage.getItem('alma.pos.venue') ?? VENUES[0]!);
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [kindByRecipe, setKindByRecipe] = useState<Map<string, string>>(new Map());
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [activeCategory, setActiveCategory] = useState('');
  const [search, setSearch] = useState('');
  const [newTable, setNewTable] = useState<null | { label: string; covers: string }>(null);
  const [charge, setCharge] = useState<null | { stage: 'tip' | 'method' | 'cash' | 'split'; tipCents: number; amountCents: number | null }>(null);
  const [tendered, setTendered] = useState('');
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [day, setDay] = useState<DaySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await api<{ user: { id: string } | null }>('/api/auth/me');
      setMe(res.user);
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
  }, [venue]);

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
      const at = COURSES.indexOf(line.course ?? 'Mains');
      return { ...line, course: COURSES[(at + 1) % COURSES.length] };
    });
    void pushLines(next);
  }

  async function openOrder(input: { tableLabel?: string; covers?: number }) {
    setBusy(true);
    setError(null);
    try {
      const created = await api<Order>('/api/pos/orders', {
        method: 'POST',
        body: JSON.stringify({ venue, ...input })
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
        {order ? (
          <button type="button" className="pos-ghost" onClick={() => { setOrder(null); void refreshOpenOrders(); }}>
            Tables
          </button>
        ) : (
          <button type="button" className="pos-ghost" onClick={() => void openDay()}>
            Day
          </button>
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
          </div>
          <div className="pos-home-grid">
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
