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
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ orderNumber: number; itemCount: number } | null>(null);

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
          lines: [...cart.entries()].map(([recipeId, quantity], index) => ({
            recipeId,
            quantity,
            notes: index === 0 && notes.trim() ? notes.trim() : undefined
          }))
        })
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.message ?? 'Could not send your order.');
      setDone({ orderNumber: payload.orderNumber, itemCount: payload.itemCount });
      setCart(new Map());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your order.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="qr-shell qr-done">
        <h1>Sent to the kitchen 🎉</h1>
        <p>
          {done.itemCount} item{done.itemCount === 1 ? '' : 's'} on the way for table {menu?.tableLabel}.
        </p>
        <p className="qr-muted">Order another round any time — everything lands on the same bill, and you pay at the table or counter as usual.</p>
        <button type="button" className="qr-submit" onClick={() => setDone(null)}>
          Order more
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
      </header>
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
        <div className="qr-cart">
          <input placeholder="Your name (optional)" value={name} onChange={(event) => setName(event.currentTarget.value)} maxLength={60} />
          <input placeholder="Any notes? (allergies etc.)" value={notes} onChange={(event) => setNotes(event.currentTarget.value)} maxLength={120} />
          <button type="button" className="qr-submit" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Sending…' : `Send ${cartCount} item${cartCount === 1 ? '' : 's'} · ${money(cartTotal)}`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
