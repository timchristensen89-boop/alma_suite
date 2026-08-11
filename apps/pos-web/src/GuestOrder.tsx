import { useEffect, useMemo, useState } from 'react';

// ── Guest QR ordering ───────────────────────────────────────────────────────
// alma-pos.web.app/#o/<token>: the page a guest lands on after scanning the
// QR at their table. Anonymous — the signed token IS the auth; all pricing is
// re-done server-side. The round lands on the table's bill and fires to the
// kitchen; the guest pays at the table or counter as usual.

type GuestMenu = {
  venue: string;
  tableLabel: string;
  categories: Array<{ name: string; items: Array<{ recipeId: string; title: string; priceCents: number }> }>;
};

const API = 'https://api.almagroup.com.au';
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function GuestOrder({ token }: { token: string }) {
  const [menu, setMenu] = useState<GuestMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  // The basket opens over the menu, which is right when you're finishing and
  // wrong when you're still choosing — a table ordering a second round could
  // not see past it. Collapsed leaves a one-line summary you can tap to open.
  const [cartOpen, setCartOpen] = useState(true);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [dietary, setDietary] = useState<string[]>([]);
  const [called, setCalled] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ orderNumber: number; itemCount: number } | null>(null);
  const [pay, setPay] = useState<null | {
    stage: 'tip' | 'paid';
    balanceCents: number;
    tipCents: number;
    orderNumber: number;
    lines: Array<{ name: string; quantity: number; totalCents: number }>;
  }>(null);

  async function openPaySheet(tipCents: number, checkout = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/qr/pay-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token, tipCents, checkout })
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.message ?? 'Could not load the bill.');
      if (checkout && payload.checkoutUrl) {
        window.location.href = payload.checkoutUrl;
        return;
      }
      setPay({
        stage: 'tip',
        balanceCents: payload.balanceCents,
        tipCents: payload.tipCents,
        orderNumber: payload.orderNumber,
        lines: payload.lines
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the bill.');
    } finally {
      setBusy(false);
    }
  }

  // Back from Square's checkout: ?qrp=<pending order id>. The redirect proves
  // nothing on its own, so the server re-checks with Square before anything
  // reaches the kitchen — this call is what actually places the round.
  useEffect(() => {
    const qrp = new URLSearchParams(window.location.search).get('qrp');
    if (!qrp) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    setBusy(true);
    fetch(`${API}/api/qr/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingId: qrp })
    })
      .then((res) => res.json())
      .then((payload) => {
        if (payload?.ok) {
          setDone({ orderNumber: payload.orderNumber ?? 0, itemCount: payload.itemCount ?? 0 });
          setCart(new Map());
        } else {
          setError(payload?.message ?? 'That payment has not completed.');
        }
      })
      .catch(() => setError('We could not confirm that payment — please check with your server.'))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Returning from Stripe Checkout: ?csid=<session id> confirms + records.
  useEffect(() => {
    const csid = new URLSearchParams(window.location.search).get('csid');
    if (!csid) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    setBusy(true);
    fetch(`${API}/api/qr/pay-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token, sessionId: csid })
    })
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.message ?? 'Payment took, but recording it failed — see staff.');
        setPay({ stage: 'paid', balanceCents: payload.paidCents ?? 0, tipCents: 0, orderNumber: 0, lines: [] });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not confirm the payment.'))
      .finally(() => setBusy(false));
  }, [token]);

  useEffect(() => {
    fetch(`${API}/api/qr/context?t=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'This QR code did not work.');
        return res.json() as Promise<GuestMenu>;
      })
      .then((next) => {
        setMenu(next);
        setOpenCat(next.categories[0]?.name ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'This QR code did not work.'));
  }, [token]);

  const items = useMemo(() => new Map((menu?.categories ?? []).flatMap((category) => category.items.map((item) => [item.recipeId, item] as const))), [menu]);
  const cartCount = [...cart.values()].reduce((sum, quantity) => sum + quantity, 0);
  const cartTotal = [...cart.entries()].reduce((sum, [recipeId, quantity]) => sum + (items.get(recipeId)?.priceCents ?? 0) * quantity, 0);

  function bump(recipeId: string, delta: number) {
    setCart((current) => {
      const next = new Map(current);
      const quantity = (next.get(recipeId) ?? 0) + delta;
      if (quantity <= 0) next.delete(recipeId);
      else next.set(recipeId, Math.min(20, quantity));
      return next;
    });
  }

  // "Can someone come over" — raises a call the register sees straight away.
  async function callStaff(kind: 'WAITER' | 'BILL') {
    try {
      const res = await fetch(`${API}/api/qr/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token, kind })
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.message ?? 'Could not reach the floor.');
      setCalled(kind === 'BILL' ? 'The bill is on its way.' : 'Someone is on their way over.');
      setTimeout(() => setCalled(null), 6000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the floor.');
    }
  }

  async function submit() {
    if (busy || cartCount === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/qr/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          t: token,
          name: name.trim() || undefined,
          dietary: dietary.length > 0 ? dietary : undefined,
          lines: [...cart.entries()].map(([recipeId, quantity], index) => ({
            recipeId,
            quantity,
            notes: index === 0 && notes.trim() ? notes.trim() : undefined
          }))
        })
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.message ?? 'Could not send your order.');
      // Pay first: the kitchen sees nothing until Square confirms. The basket
      // is deliberately left intact — if they abandon checkout and come back,
      // their order is still here rather than silently gone.
      if (payload.checkoutUrl) {
        window.location.href = payload.checkoutUrl;
        return;
      }
      throw new Error('Could not start the payment. Please order with your server.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your order.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="qr-shell qr-done">
        <h1>Paid — off to the kitchen 🎉</h1>
        <p>
          {done.itemCount} item{done.itemCount === 1 ? '' : 's'} on the way for table {menu?.tableLabel}.
        </p>
        <p className="qr-muted">Paid — thank you. Order another round any time; each one is paid as you go.</p>
        <button type="button" className="qr-submit" onClick={() => setDone(null)}>
          Order more
        </button>
        <button type="button" className="qr-paylink" disabled={busy} onClick={() => void openPaySheet(0)}>
          View bill &amp; pay by card
        </button>
      </div>
    );
  }

  return (
    <div className="qr-shell">
      <header className="qr-header">
        <strong>ALMA</strong>
        <span>
          {menu ? `${menu.venue} · Table ${menu.tableLabel}` : 'Loading…'}
        </span>
        <span style={{ flex: 1 }} />
        {menu ? (
          <button type="button" className="qr-billbtn" disabled={busy} onClick={() => void openPaySheet(0)}>
            Bill
          </button>
        ) : null}
      </header>

      {pay ? (
        <div className="qr-pay" role="dialog">
          <div className="qr-pay-panel">
            {pay.stage === 'paid' ? (
              <>
                <h2>Paid — thank you! 💚</h2>
                <p className="qr-muted">
                  {pay.balanceCents > 0 ? `${money(pay.balanceCents)} settled` : 'Payment settled'} on table {menu?.tableLabel}. A receipt is available at the counter.
                </p>
                <button type="button" className="qr-submit" onClick={() => setPay(null)}>
                  Done
                </button>
              </>
            ) : (
              <>
                <h2>Your bill · #{pay.orderNumber}</h2>
                <div className="qr-bill-lines">
                  {pay.lines.map((line, index) => (
                    <div key={index}>
                      <span>
                        {line.quantity}× {line.name}
                      </span>
                      <b>{money(line.totalCents)}</b>
                    </div>
                  ))}
                  <div className="qr-bill-total">
                    <span>To pay{pay.tipCents > 0 ? ` (incl. ${money(pay.tipCents)} tip)` : ''}</span>
                    <b>{money(pay.balanceCents + pay.tipCents)}</b>
                  </div>
                </div>
                <p className="qr-muted">Add a tip for the team?</p>
                <div className="qr-tips">
                  {[0, 5, 10].map((pct) => {
                    const cents = Math.round((pay.balanceCents * pct) / 100);
                    return (
                      <button
                        key={pct}
                        type="button"
                        className={pay.tipCents === cents ? 'is-on' : ''}
                        disabled={busy}
                        onClick={() => setPay({ ...pay, tipCents: cents })}
                      >
                        {pct === 0 ? 'No tip' : `+${pct}% (${money(cents)})`}
                      </button>
                    );
                  })}
                </div>
                <button type="button" className="qr-submit" disabled={busy} onClick={() => void openPaySheet(pay.tipCents, true)}>
                  {busy ? 'Opening secure payment…' : `Pay ${money(pay.balanceCents + pay.tipCents)} by card`}
                </button>
              </>
            )}
            <button type="button" className="qr-paylink" onClick={() => setPay(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
      {error ? <div className="qr-error">{error}</div> : null}

      {(menu?.categories ?? []).map((category) => (
        <section key={category.name} className="qr-cat">
          <button type="button" className="qr-cat-head" onClick={() => setOpenCat(openCat === category.name ? null : category.name)}>
            {category.name}
            <span>{openCat === category.name ? '−' : '+'}</span>
          </button>
          {openCat === category.name
            ? category.items.map((item) => {
                const quantity = cart.get(item.recipeId) ?? 0;
                return (
                  <div key={item.recipeId} className="qr-item">
                    <span className="qr-item-name">
                      {item.title}
                      <small>{money(item.priceCents)}</small>
                    </span>
                    {quantity === 0 ? (
                      <button type="button" className="qr-add" onClick={() => bump(item.recipeId, 1)}>
                        Add
                      </button>
                    ) : (
                      <span className="qr-stepper">
                        <button type="button" onClick={() => bump(item.recipeId, -1)}>−</button>
                        <b>{quantity}</b>
                        <button type="button" onClick={() => bump(item.recipeId, 1)}>+</button>
                      </span>
                    )}
                  </div>
                );
              })
            : null}
        </section>
      ))}

      {cartCount > 0 ? (
        <div className={cartOpen ? 'qr-cart' : 'qr-cart is-min'}>
          <button
            type="button"
            className="qr-cart-toggle"
            aria-expanded={cartOpen}
            onClick={() => setCartOpen((open) => !open)}
          >
            <span>
              {cartCount} item{cartCount === 1 ? '' : 's'} · {money(cartTotal)}
            </span>
            <em>{cartOpen ? '▾ hide' : '▴ show'}</em>
          </button>
          <input placeholder="Your name (optional)" value={name} onChange={(event) => setName(event.currentTarget.value)} maxLength={60} />
          <div className="qr-diet">
            <p className="qr-muted">Anything we need to know? These reach the kitchen with your order.</p>
            <div className="qr-diet-chips">
              {['Gluten free', 'Dairy free', 'Vegan', 'Vegetarian', 'Nut allergy', 'Shellfish allergy'].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={dietary.includes(tag) ? 'is-on' : ''}
                  onClick={() =>
                    setDietary((current) => (current.includes(tag) ? current.filter((entry) => entry !== tag) : [...current, tag]))
                  }
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
          <input placeholder="Any notes? (allergies etc.)" value={notes} onChange={(event) => setNotes(event.currentTarget.value)} maxLength={120} />
          <div className="qr-callrow">
            <button type="button" className="qr-call" onClick={() => void callStaff('WAITER')}>
              🙋 Call someone over
            </button>
            <button type="button" className="qr-call" onClick={() => void callStaff('BILL')}>
              🧾 Ask for the bill
            </button>
          </div>
          {called ? <p className="qr-called">{called}</p> : null}
          <button type="button" className="qr-submit" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Taking you to payment…' : `Pay ${money(cartTotal)} · ${cartCount} item${cartCount === 1 ? '' : 's'}`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
