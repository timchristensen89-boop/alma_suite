import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from './lib/api';

/**
 * The counter screen — an iPad standing on the pass, used by whoever is on.
 *
 * Two jobs, and they are the two that happen in the room: sell a card to
 * somebody standing there, and take one off a guest paying their bill. Both
 * previously only existed inside the manager dashboard, which is a desk tool
 * with small controls and a lot of things on it that a busy floor should not
 * be able to touch.
 *
 * Everything here is sized for a thumb on a wet hand, and every number the
 * guest cares about is large enough to read from the other side of the pass.
 */

type Card = {
  code: string;
  status: string;
  balanceCents: number;
  initialValueCents: number;
  expiresAt?: string | null;
  recipientName?: string | null;
};

const money = (cents: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);

/** Amounts a venue actually sells. Anything else goes in the keypad. */
const QUICK_AMOUNTS = [50, 100, 150, 200, 250, 500];

export function CounterApp() {
  const [mode, setMode] = useState<'sell' | 'redeem'>('sell');

  return (
    <div className="counter">
      <header className="counter-bar">
        <span className="counter-brand">alma · gift cards</span>
        <div className="counter-modes" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'sell'}
            className={mode === 'sell' ? 'is-on' : ''}
            onClick={() => setMode('sell')}
          >
            Sell a card
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'redeem'}
            className={mode === 'redeem' ? 'is-on' : ''}
            onClick={() => setMode('redeem')}
          >
            Redeem
          </button>
        </div>
      </header>
      {mode === 'sell' ? <SellPanel /> : <RedeemPanel />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sell                                                                */
/* ------------------------------------------------------------------ */

function SellPanel() {
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [recipient, setRecipient] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cents = useMemo(() => {
    if (amount !== null) return amount * 100;
    const parsed = Number(custom.replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
  }, [amount, custom]);

  async function sell() {
    if (cents < 500) {
      setError('A card has to be at least $5.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // No code sent: the server issues one. That is the whole point of this
      // screen — staff write the number it gives back onto a blank card.
      const card = await api<Card>('/api/gift-cards/physical/activate', {
        method: 'POST',
        body: JSON.stringify({
          initialValueCents: cents,
          purchaserName: 'Counter sale',
          recipientName: recipient.trim() || null,
          recipientEmail: email.trim() || null
        })
      });
      setIssued(card);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not issue that card.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setIssued(null);
    setAmount(null);
    setCustom('');
    setRecipient('');
    setEmail('');
    setError(null);
  }

  if (issued) {
    return (
      <main className="counter-body counter-issued">
        <p className="counter-kicker">Write this on the card</p>
        {/* The number is the deliverable. Everything else on this screen is
            smaller than it on purpose. */}
        <p className="counter-code">{issued.code}</p>
        <p className="counter-issued-value">{money(issued.balanceCents)} · active now</p>
        {issued.expiresAt ? (
          <p className="counter-note">
            Valid until {new Date(issued.expiresAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        ) : null}
        {email.trim() ? <p className="counter-note">A copy has been emailed to {email.trim()}.</p> : null}
        <button type="button" className="counter-primary" onClick={reset}>
          Sell another
        </button>
      </main>
    );
  }

  return (
    <main className="counter-body">
      <p className="counter-kicker">How much?</p>
      <div className="counter-amounts">
        {QUICK_AMOUNTS.map((value) => (
          <button
            key={value}
            type="button"
            className={amount === value ? 'is-on' : ''}
            onClick={() => { setAmount(value); setCustom(''); }}
          >
            ${value}
          </button>
        ))}
      </div>

      <label className="counter-field">
        <span>Or another amount</span>
        <input
          inputMode="decimal"
          placeholder="$"
          value={custom}
          onChange={(event) => { setCustom(event.target.value); setAmount(null); }}
        />
      </label>

      <div className="counter-optional">
        <label className="counter-field">
          <span>Who it's for (optional)</span>
          <input value={recipient} onChange={(event) => setRecipient(event.target.value)} />
        </label>
        <label className="counter-field">
          <span>Email them a copy (optional)</span>
          <input inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
      </div>

      {error ? <p className="counter-error">{error}</p> : null}

      <button type="button" className="counter-primary" disabled={busy || cents < 500} onClick={() => void sell()}>
        {busy ? 'Issuing…' : cents > 0 ? `Issue a ${money(cents)} card` : 'Choose an amount'}
      </button>
      <p className="counter-note">Take the payment on the till first, then issue the card.</p>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Redeem                                                              */
/* ------------------------------------------------------------------ */

function RedeemPanel() {
  const [code, setCode] = useState('');
  const [card, setCard] = useState<Card | null>(null);
  const [spend, setSpend] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ took: number; left: number } | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { codeRef.current?.focus(); }, []);

  async function lookup() {
    const value = code.trim().toUpperCase();
    if (!value) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setCard(await api<Card>(`/api/gift-cards/cards/${encodeURIComponent(value)}`));
    } catch (err) {
      setCard(null);
      setError(err instanceof ApiError ? err.message : 'No card with that number.');
    } finally {
      setBusy(false);
    }
  }

  async function redeem(cents: number) {
    if (!card) return;
    if (cents <= 0) { setError('Enter how much to take off.'); return; }
    if (cents > card.balanceCents) { setError(`That card only has ${money(card.balanceCents)} on it.`); return; }
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Card>('/api/gift-cards/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: card.code, amountCents: cents })
      });
      setDone({ took: cents, left: updated.balanceCents });
      setCard(updated);
      setSpend('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not redeem that.');
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setCode(''); setCard(null); setSpend(''); setDone(null); setError(null);
    codeRef.current?.focus();
  }

  const spendCents = Math.round((Number(spend.replace(/[^0-9.]/g, '')) || 0) * 100);

  if (done && card) {
    return (
      <main className="counter-body counter-issued">
        <p className="counter-kicker">Taken off</p>
        <p className="counter-code">{money(done.took)}</p>
        <p className="counter-issued-value">
          {done.left > 0 ? `${money(done.left)} left on ${card.code}` : `${card.code} is now empty`}
        </p>
        {done.left > 0 ? <p className="counter-note">Hand the card back — there's still money on it.</p> : null}
        <button type="button" className="counter-primary" onClick={startOver}>Next card</button>
      </main>
    );
  }

  return (
    <main className="counter-body">
      <p className="counter-kicker">Card number</p>
      <form
        className="counter-lookup"
        onSubmit={(event) => { event.preventDefault(); void lookup(); }}
      >
        <input
          ref={codeRef}
          className="counter-code-input"
          placeholder="ALMA-…"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
        <button type="submit" disabled={busy || !code.trim()}>{busy ? '…' : 'Find'}</button>
      </form>

      {error ? <p className="counter-error">{error}</p> : null}

      {card ? (
        <section className="counter-card-found">
          <p className="counter-kicker">{card.code}</p>
          <p className="counter-balance">{money(card.balanceCents)}</p>
          <p className="counter-note">
            {card.status !== 'ACTIVE'
              ? `This card is ${card.status.toLowerCase().replace('_', ' ')} — it cannot be used.`
              : card.recipientName
                ? `For ${card.recipientName}`
                : 'Ready to use'}
          </p>

          {card.status === 'ACTIVE' && card.balanceCents > 0 ? (
            <>
              <div className="counter-amounts">
                {/* Taking the whole balance is the common case, so it is one
                    tap rather than typing the number they can already see. */}
                <button type="button" onClick={() => void redeem(card.balanceCents)} disabled={busy}>
                  Use it all
                </button>
              </div>
              <label className="counter-field">
                <span>Or take off a part</span>
                <input inputMode="decimal" placeholder="$" value={spend} onChange={(event) => setSpend(event.target.value)} />
              </label>
              <button
                type="button"
                className="counter-primary"
                disabled={busy || spendCents <= 0}
                onClick={() => void redeem(spendCents)}
              >
                {busy ? 'Working…' : spendCents > 0 ? `Take off ${money(spendCents)}` : 'Enter an amount'}
              </button>
            </>
          ) : null}
          <button type="button" className="counter-secondary" onClick={startOver}>Different card</button>
        </section>
      ) : null}
    </main>
  );
}
