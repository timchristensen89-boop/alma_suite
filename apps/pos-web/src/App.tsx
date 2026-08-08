import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, messageForError } from './api';

// ── ALMA POS — counter-mode register MVP ────────────────────────────────────
// One screen: menu grid on the left, cart on the right, charge flow in a
// modal. The menu is the suite's own recipe list; orders/payments land in the
// suite natively. Payments: cash (tender + change) and card taken on an
// external EFTPOS terminal (recorded). Stripe Terminal slots in later.

type MenuItem = { recipeId: string; title: string; priceCents: number; venue: string | null };
type MenuCategory = { name: string; kind: string; items: MenuItem[] };
type CartLine = { recipeId: string | null; name: string; unitPriceCents: number; quantity: number };
type PaidOrder = {
  id: string;
  orderNumber: number;
  totalCents: number;
  gstCents: number;
  tipCents: number;
  changeCents?: number | null;
  lines: Array<{ name: string; quantity: number; totalCents: number }>;
  payments: Array<{ method: string; amountCents: number; tipCents: number }>;
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

function money(cents: number) {
  return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

export function App() {
  const [me, setMe] = useState<{ id: string } | null | 'loading'>('loading');
  const [venue, setVenue] = useState<string>(() => localStorage.getItem('alma.pos.venue') ?? VENUES[0]!);
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [charge, setCharge] = useState<null | { stage: 'tip' | 'method' | 'cash'; tipCents: number }>(null);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState<PaidOrder | null>(null);
  const [day, setDay] = useState<DaySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tendered, setTendered] = useState('');

  const refreshAuth = useCallback(async () => {
    try {
      const res = await api<{ user: { id: string } | null }>('/api/auth/me');
      setMe(res.user);
    } catch {
      setMe(null);
    }
  }, []);

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
      } catch (err) {
        setError(messageForError(err, 'Could not load the menu.'));
      }
    })();
  }, [me]);

  const totalCents = useMemo(() => cart.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0), [cart]);

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term) {
      return menu.flatMap((category) => category.items).filter((item) => item.title.toLowerCase().includes(term)).slice(0, 60);
    }
    return menu.find((category) => category.name === activeCategory)?.items ?? [];
  }, [menu, activeCategory, search]);

  function addItem(item: MenuItem) {
    setCart((current) => {
      const existing = current.find((line) => line.recipeId === item.recipeId);
      if (existing) {
        return current.map((line) => (line.recipeId === item.recipeId ? { ...line, quantity: line.quantity + 1 } : line));
      }
      return [...current, { recipeId: item.recipeId, name: item.title, unitPriceCents: item.priceCents, quantity: 1 }];
    });
  }

  function bumpQty(index: number, delta: number) {
    setCart((current) =>
      current
        .map((line, i) => (i === index ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0)
    );
  }

  async function completeCharge(method: 'CASH' | 'CARD_EXTERNAL') {
    if (!charge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const order = await api<{ id: string }>('/api/pos/orders', {
        method: 'POST',
        body: JSON.stringify({ venue })
      });
      await api(`/api/pos/orders/${order.id}/lines`, {
        method: 'PUT',
        body: JSON.stringify({ lines: cart })
      });
      const tenderedCents = method === 'CASH' ? Math.round(Number(tendered || '0') * 100) || totalCents + charge.tipCents : undefined;
      const result = await api<PaidOrder>(`/api/pos/orders/${order.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ method, tipCents: charge.tipCents, tenderedCents })
      });
      setPaid(result);
      setCart([]);
      setCharge(null);
      setTendered('');
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

  const due = totalCents + (charge?.tipCents ?? 0);

  return (
    <div className="pos-shell">
      <header className="pos-header">
        <strong>ALMA POS</strong>
        <select value={venue} onChange={(event) => setVenue(event.currentTarget.value)}>
          {VENUES.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <input
          className="pos-search"
          placeholder="Search menu…"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        <span style={{ flex: 1 }} />
        <button type="button" className="pos-ghost" onClick={() => void openDay()}>
          Day
        </button>
      </header>

      {error ? (
        <div className="pos-error" onClick={() => setError(null)}>
          {error} — tap to dismiss
        </div>
      ) : null}

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
            {cart.length === 0 ? <p className="pos-muted">Tap items to start a sale.</p> : null}
            {cart.map((line, index) => (
              <div key={`${line.recipeId}-${index}`} className="pos-line">
                <span className="pos-line-name">{line.name}</span>
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
            <div className="pos-totals">
              <span>Total (incl. GST {money(Math.round(totalCents / 11))})</span>
              <strong>{money(totalCents)}</strong>
            </div>
            <div className="pos-cart-actions">
              <button type="button" className="pos-ghost" disabled={cart.length === 0 || busy} onClick={() => setCart([])}>
                Clear
              </button>
              <button
                type="button"
                className="pos-charge"
                disabled={cart.length === 0 || busy}
                onClick={() => setCharge({ stage: 'tip', tipCents: 0 })}
              >
                Charge {money(totalCents)}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {charge ? (
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
                      onClick={() => setCharge({ stage: 'method', tipCents: Math.round((totalCents * pct) / 100) })}
                    >
                      {pct === 0 ? 'No tip' : `+${pct}% (${money(Math.round((totalCents * pct) / 100))})`}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {charge.stage === 'method' ? (
              <>
                <h2>{money(due)}</h2>
                {charge.tipCents > 0 ? <p className="pos-muted">includes {money(charge.tipCents)} tip</p> : null}
                <div className="pos-choice-row">
                  <button type="button" disabled={busy} onClick={() => void completeCharge('CARD_EXTERNAL')}>
                    Card (terminal)
                  </button>
                  <button type="button" disabled={busy} onClick={() => setCharge({ ...charge, stage: 'cash' })}>
                    Cash
                  </button>
                </div>
              </>
            ) : null}
            {charge.stage === 'cash' ? (
              <>
                <h2>Cash — {money(due)}</h2>
                <div className="pos-choice-row">
                  {[due, Math.ceil(due / 5000) * 5000, Math.ceil(due / 10000) * 10000]
                    .filter((v, i, a) => a.indexOf(v) === i)
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
                {tendered && Math.round(Number(tendered) * 100) >= due ? (
                  <p className="pos-change">Change: {money(Math.round(Number(tendered) * 100) - due)}</p>
                ) : null}
                <button
                  type="button"
                  className="pos-charge"
                  disabled={busy || !tendered || Math.round(Number(tendered) * 100) < due}
                  onClick={() => void completeCharge('CASH')}
                >
                  Take cash
                </button>
              </>
            ) : null}
            <button type="button" className="pos-ghost pos-modal-close" disabled={busy} onClick={() => setCharge(null)}>
              Back to sale
            </button>
          </div>
        </div>
      ) : null}

      {paid ? (
        <div className="pos-modal" role="dialog">
          <div className="pos-modal-panel pos-receipt" id="pos-receipt">
            <h2>Paid — order #{paid.orderNumber}</h2>
            {paid.changeCents ? <p className="pos-change">Change due: {money(paid.changeCents)}</p> : null}
            <div className="pos-receipt-lines">
              {paid.lines.map((line, index) => (
                <div key={index}>
                  <span>
                    {line.quantity}× {line.name}
                  </span>
                  <span>{money(line.totalCents)}</span>
                </div>
              ))}
              <div className="pos-receipt-total">
                <span>Total (incl. {money(paid.gstCents)} GST{paid.tipCents ? ` + ${money(paid.tipCents)} tip` : ''})</span>
                <span>{money(paid.totalCents + paid.tipCents)}</span>
              </div>
            </div>
            <div className="pos-choice-row">
              <button type="button" className="pos-ghost" onClick={() => window.print()}>
                Print receipt
              </button>
              <button type="button" className="pos-charge" onClick={() => setPaid(null)}>
                New sale
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
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          required
        />
        {error ? <p className="pos-error-inline">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Open register'}
        </button>
      </form>
    </div>
  );
}
