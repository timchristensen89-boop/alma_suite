import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from './lib/api';
import {
  DONATION_ANNUAL_CAP,
  DONATION_CRITERIA,
  EMPTY_DONATION_CRITERIA,
  assessDonation,
  donationConditions,
  isDonationBlackout,
  type DonationAllocation,
  type DonationCriteria,
  type DonationCriterionId,
  type GiftCardRedemptionInput
} from '@alma/shared';
import { ScanSheet } from './ScanSheet';

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
  /**
   * Present only on a voucher given away under the donation policy. It carries
   * conditions an ordinary card does not — dine-in, never a Friday or Saturday
   * night — and the person holding it will not have read them.
   */
  donation?: {
    organisation: string;
    reference: string;
    venue: string;
    conditions: string;
  } | null;
};

/**
 * The conditions banner. Shown wherever a donation voucher is on screen, and
 * shown loudly when it is presented inside the blackout — a Friday or Saturday
 * evening is exactly when a full room cannot absorb it, which is the whole
 * reason the restriction exists.
 *
 * It warns; it does not block. A manager standing in a quiet Friday can still
 * take it, and a rule the owner cannot override stops being a policy and starts
 * being an obstacle.
 */
function DonationConditions({ card }: { card: Card }) {
  if (!card.donation) return null;
  const blackout = isDonationBlackout(new Date());
  return (
    <div className={`counter-donation-note ${blackout ? 'is-blackout' : ''}`}>
      <p className="counter-donation-head">
        Donation voucher · {card.donation.organisation} · {card.donation.reference}
      </p>
      <p>{card.donation.conditions}</p>
      {blackout ? (
        <p className="counter-donation-blackout">
          It is a Friday or Saturday evening — this voucher is not valid now. Take it only if a manager says so.
        </p>
      ) : null}
    </div>
  );
}

const money = (cents: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);

/** Amounts a venue actually sells. Anything else goes in the keypad. */
const QUICK_AMOUNTS = [50, 100, 150, 200, 250, 500];

/**
 * Where the money lands. Every redemption is revenue for one venue, and an
 * unredeemed balance is a liability until it does — so the API requires this
 * and rejects the redemption outright without it.
 *
 * These are the API's own canonical spellings (gift-card.service
 * REDEMPTION_VENUES). It normalises loose spellings, but sending exactly what
 * it expects means the counter never depends on that.
 */
const COUNTER_VENUES = ['Alma Avalon', 'St Alma', 'Functions / Pop-up'];

/**
 * A counter iPad stands in one venue all day, so asking every single time is
 * friction that gets tapped past. Asked once, remembered, and changeable.
 */
const VENUE_KEY = 'alma.giftcards.counter.venue';

function loadVenue(): string {
  try {
    const saved = localStorage.getItem(VENUE_KEY);
    return saved && COUNTER_VENUES.includes(saved) ? saved : '';
  } catch {
    return '';
  }
}

function rememberVenue(venue: string) {
  try {
    localStorage.setItem(VENUE_KEY, venue);
  } catch {
    // A locked-down browser refusing storage is not a reason to block a sale;
    // the venue is still held in state for this session.
  }
}

type Tender = 'CARD' | 'CASH' | 'EFTPOS' | 'STRIPE' | 'COMP';

const TENDERS: Array<{ id: Tender; label: string; hint: string }> = [
  { id: 'CARD', label: 'Card on the till', hint: 'Rung through the venue POS' },
  { id: 'EFTPOS', label: 'EFTPOS', hint: 'Rung through the venue POS' },
  { id: 'CASH', label: 'Cash', hint: 'Into the drawer' },
  { id: 'STRIPE', label: 'Card now', hint: 'Guest taps on their own phone' },
  { id: 'COMP', label: 'Comp', hint: 'No money taken' }
];

export function CounterApp() {
  const [mode, setMode] = useState<'sell' | 'balance' | 'redeem' | 'donate'>('sell');

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
            aria-selected={mode === 'balance'}
            className={mode === 'balance' ? 'is-on' : ''}
            onClick={() => setMode('balance')}
          >
            Check balance
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
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'donate'}
            className={mode === 'donate' ? 'is-on' : ''}
            onClick={() => setMode('donate')}
          >
            Donation
          </button>
        </div>
      </header>
      {mode === 'sell' ? (
        <SellPanel />
      ) : mode === 'balance' ? (
        <BalancePanel />
      ) : mode === 'redeem' ? (
        <RedeemPanel />
      ) : (
        <DonatePanel />
      )}
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
  // How the money is coming in. CARD/CASH/EFTPOS are rung on the venue's own
  // till and recorded here so the card reconciles against takings; STRIPE
  // takes the payment now, on the customer's phone.
  const [tender, setTender] = useState<Tender>('CARD');
  const [reference, setReference] = useState('');
  const [pay, setPay] = useState<{ url: string; sessionId: string } | null>(null);

  const cents = useMemo(() => {
    if (amount !== null) return amount * 100;
    const parsed = Number(custom.replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
  }, [amount, custom]);

  /**
   * Take the payment through Stripe on the customer's own phone.
   *
   * They scan the QR and pay there, so no card details touch this iPad and the
   * venue needs no reader hardware. We poll the session until Stripe confirms,
   * then show the code exactly as a till-paid sale does.
   */
  async function payByCard() {
    if (cents < 500) {
      setError('A card has to be at least $5.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await api<{ checkoutUrl: string; checkoutSessionId: string }>(
        '/api/gift-cards/counter/checkout',
        {
          method: 'POST',
          body: JSON.stringify({
            amountCents: cents,
            purchaserName: recipient.trim() || 'Counter sale',
            purchaserEmail: email.trim() || 'counter@almagroup.com.au',
            recipientName: recipient.trim() || '',
            recipientEmail: email.trim() || ''
          })
        }
      );
      setPay({ url: session.checkoutUrl, sessionId: session.checkoutSessionId });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start that payment.');
      setBusy(false);
    }
  }

  // Poll only while a payment is on screen. The session endpoint 404s until
  // Stripe confirms, so a miss is the normal state, not an error.
  useEffect(() => {
    if (!pay) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const card = await api<Card>(`/api/gift-cards/session/${encodeURIComponent(pay.sessionId)}`);
        if (cancelled) return;
        setIssued(card);
        setPay(null);
        setBusy(false);
      } catch {
        // Not paid yet.
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pay]);

  async function sell() {
    if (cents < 500) {
      setError('A card has to be at least $5.');
      return;
    }
    if (tender === 'STRIPE') {
      await payByCard();
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
          recipientEmail: email.trim() || null,
          tender,
          tenderReference: reference.trim() || null
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
    setReference('');
    setPay(null);
    setBusy(false);
  }

  if (pay) {
    // A QR the guest scans with their own camera. Their phone is the card
    // terminal — nothing sensitive passes through this iPad.
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=440x440&margin=8&data=${encodeURIComponent(pay.url)}`;
    return (
      <main className="counter-body counter-pay">
        <p className="counter-kicker">Ask them to scan this</p>
        <img className="counter-qr" src={qr} alt="Scan to pay" width={220} height={220} />
        <p className="counter-issued-value">{money(cents)} to pay</p>
        <p className="counter-note">Waiting for the payment… the card issues itself the moment it lands.</p>
        <button type="button" className="counter-secondary" onClick={reset}>
          Cancel
        </button>
      </main>
    );
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

      <p className="counter-kicker">How are they paying?</p>
      <div className="counter-tenders">
        {TENDERS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={tender === option.id ? 'is-on' : ''}
            onClick={() => setTender(option.id)}
          >
            <strong>{option.label}</strong>
            <small>{option.hint}</small>
          </button>
        ))}
      </div>

      {/* Only worth asking for on a till sale — it is the thread back to the
          POS receipt when the takings are reconciled. */}
      {tender === 'CARD' || tender === 'EFTPOS' || tender === 'CASH' ? (
        <label className="counter-field">
          <span>Receipt or last 4 (optional)</span>
          <input value={reference} onChange={(event) => setReference(event.target.value)} />
        </label>
      ) : null}

      {error ? <p className="counter-error">{error}</p> : null}

      <button type="button" className="counter-primary" disabled={busy || cents < 500} onClick={() => void sell()}>
        {busy
          ? tender === 'STRIPE' ? 'Starting payment…' : 'Issuing…'
          : cents > 0
            ? tender === 'STRIPE' ? `Take ${money(cents)} by card` : `Issue a ${money(cents)} card`
            : 'Choose an amount'}
      </button>
      <p className="counter-note">
        {tender === 'STRIPE'
          ? 'The guest pays on their phone. The card issues itself once Stripe confirms.'
          : tender === 'COMP'
            ? 'No payment recorded — this card will not count towards takings.'
            : 'Ring the payment through the till, then issue the card.'}
      </p>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Balance                                                             */
/* ------------------------------------------------------------------ */

/**
 * Read-only balance lookup.
 *
 * Its own screen on purpose. "What's left on this?" is the most common
 * question at the counter, and answering it inside the redeem flow puts a
 * spend button under the thumb of someone who only meant to look.
 */
function BalancePanel() {
  const [code, setCode] = useState('');
  const [card, setCard] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  async function look(raw?: string) {
    const value = (raw ?? code).trim().toUpperCase();
    if (!value) return;
    setBusy(true);
    setError(null);
    setCard(null);
    try {
      setCard(await api<Card>(`/api/gift-cards/cards/${encodeURIComponent(value)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No card with that number.');
    } finally {
      setBusy(false);
    }
  }

  const spent = card ? card.initialValueCents - card.balanceCents : 0;

  return (
    <main className="counter-body">
      <button type="button" className="counter-primary counter-scanbtn" onClick={() => setScanning(true)}>
        ▣ Scan the card
      </button>
      {scanning ? (
        <ScanSheet
          onCode={(scanned) => {
            setScanning(false);
            setCode(scanned);
            void look(scanned);
          }}
          onClose={() => setScanning(false)}
        />
      ) : null}
      <p className="counter-kicker">Or type the number</p>
      <label className="counter-field">
        <span className="sr-only">Card number</span>
        <input
          className="counter-code-input"
          autoCapitalize="characters"
          placeholder="ALMA-XXXXXXXX"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void look();
          }}
        />
      </label>
      <button type="button" className="counter-primary" disabled={busy || !code.trim()} onClick={() => void look()}>
        {busy ? 'Looking…' : 'Check balance'}
      </button>

      {error ? <p className="counter-error">{error}</p> : null}

      {card ? (
        <div className="counter-balance">
          {/* The balance is the answer; everything else is context. */}
          <p className="counter-code">{money(card.balanceCents)}</p>
          <p className="counter-issued-value">
            {card.status === 'ACTIVE'
              ? 'Good to use'
              : card.status === 'REDEEMED'
                ? 'Fully used'
                : card.status.replace('_', ' ').toLowerCase()}
          </p>
          <DonationConditions card={card} />
          <p className="counter-note">
            {money(card.initialValueCents)} originally
            {spent > 0 ? ` · ${money(spent)} spent` : ' · nothing spent yet'}
            {card.expiresAt
              ? ` · valid until ${new Date(card.expiresAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}`
              : ''}
          </p>
        </div>
      ) : null}
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
  const [scanning, setScanning] = useState(false);
  const [venue, setVenue] = useState(loadVenue);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { codeRef.current?.focus(); }, []);

  async function lookup(raw?: string) {
    const value = (raw ?? code).trim().toUpperCase();
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
    // Caught here so the counter says what to do about it. Without a venue the
    // API rejects the whole redemption, and its message is the bare word
    // "Required" — which is what staff were staring at.
    if (!venue) { setError('Tap which venue is taking this first — that is where the money lands.'); return; }
    setBusy(true);
    setError(null);
    try {
      // Typed against the API's own input schema. This is the guard that was
      // missing: an untyped object literal let this panel ship without a venue
      // at all, and nothing said so until a manager could not redeem a card.
      const body: GiftCardRedemptionInput = { code: card.code, amountCents: cents, venue };
      const updated = await api<Card>('/api/gift-cards/redeem', {
        method: 'POST',
        body: JSON.stringify(body)
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
      {/* First thing on the screen, because the redemption is refused without
          it. Remembered after the first tap, so this is a one-off on each
          counter rather than a question before every card. */}
      <p className="counter-kicker">Taking this at</p>
      <div className="counter-venues" role="group" aria-label="Venue taking this redemption">
        {COUNTER_VENUES.map((name) => (
          <button
            key={name}
            type="button"
            className={venue === name ? 'is-on' : ''}
            aria-pressed={venue === name}
            onClick={() => { setVenue(name); rememberVenue(name); setError(null); }}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Scanning is the fast path — the guest holds up their pass and the
          code never gets typed. The keyboard stays for worn printed cards. */}
      <button type="button" className="counter-primary counter-scanbtn" onClick={() => setScanning(true)}>
        ▣ Scan the card
      </button>
      <p className="counter-kicker">Or type the number</p>
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
      {scanning ? (
        <ScanSheet
          onCode={(scanned) => {
            setScanning(false);
            setCode(scanned);
            void lookup(scanned);
          }}
          onClose={() => setScanning(false)}
        />
      ) : null}

      {error ? <p className="counter-error">{error}</p> : null}

      {card ? (
        <section className="counter-card-found">
          <p className="counter-kicker">{card.code}</p>
          <p className="counter-balance">{money(card.balanceCents)}</p>
          <DonationConditions card={card} />
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

/* ------------------------------------------------------------------ */
/* Donation                                                            */
/* ------------------------------------------------------------------ */

const DONATION_VENUES = ['St Alma', 'Alma Avalon', 'Either venue'];
const DONATION_AMOUNTS = [150, 175, 200];

/**
 * Somebody has walked in and asked, or rung, and the answer is needed now.
 *
 * The screen leads with how many of the year's twelve are left, because that is
 * the fact that decides it. Cash is not offered — the policy does not have a
 * cash option, so neither does the till. Everything the register needs is asked
 * here rather than promised to be filled in later, because later never comes.
 */
function DonatePanel() {
  const [allocation, setAllocation] = useState<DonationAllocation | null>(null);
  const [organisation, setOrganisation] = useState('');
  const [cause, setCause] = useState('');
  const [venue, setVenue] = useState('St Alma');
  const [amount, setAmount] = useState(200);
  const [criteria, setCriteria] = useState<DonationCriteria>({ ...EMPTY_DONATION_CRITERIA });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ card: Card; donation: { sequence: number; year: number } } | null>(null);

  const refresh = () => {
    api<DonationAllocation>('/api/gift-cards/donations/allocation')
      .then(setAllocation)
      .catch(() => setError('Could not check how many are left this year.'));
  };

  useEffect(refresh, []);

  const verdict = useMemo(
    () =>
      assessDonation({
        amountCents: amount * 100,
        used: allocation?.used ?? 0,
        criteria,
        organisation
      }),
    [amount, allocation, criteria, organisation]
  );

  function toggle(id: DonationCriterionId) {
    setCriteria((current) => ({ ...current, [id]: !current[id] }));
  }

  async function give() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ card: Card; donation: { sequence: number; year: number } }>(
        '/api/gift-cards/donations',
        {
          method: 'POST',
          body: JSON.stringify({
            organisation: organisation.trim(),
            cause: cause.trim() || null,
            venue,
            amountCents: amount * 100,
            ...criteria
          })
        }
      );
      setIssued(result);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not issue that voucher.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setIssued(null);
    setOrganisation('');
    setCause('');
    setAmount(200);
    setCriteria({ ...EMPTY_DONATION_CRITERIA });
    setError(null);
  }

  if (issued) {
    return (
      <main className="counter-body counter-issued">
        <p className="counter-kicker">Write this on the voucher</p>
        <p className="counter-code">{issued.card.code}</p>
        <p className="counter-issued-value">
          {money(issued.card.initialValueCents)} · {issued.donation.year}/{issued.donation.sequence}
        </p>
        <p className="counter-note">{donationConditions()}</p>
        <button type="button" className="counter-primary" onClick={reset}>
          Done
        </button>
      </main>
    );
  }

  const remaining = allocation?.remaining ?? 0;

  return (
    <main className="counter-body">
      <div className={`counter-allocation ${remaining <= 0 ? 'is-spent' : remaining <= 2 ? 'is-low' : ''}`}>
        <strong>{allocation ? remaining : '—'}</strong>
        <span>
          of {allocation?.cap ?? DONATION_ANNUAL_CAP} left {allocation ? `for ${allocation.year}` : ''}
        </span>
      </div>

      {remaining <= 0 && allocation ? (
        <p className="counter-note counter-donation-blackout">
          They are all gone for {allocation.year}. The answer is no until the calendar turns — there is a template for
          saying so on the Donations screen.
        </p>
      ) : null}

      <label className="counter-field">
        <span>Who is asking</span>
        <input value={organisation} onChange={(event) => setOrganisation(event.target.value)} placeholder="Freshwater SLSC" />
      </label>
      <label className="counter-field">
        <span>What for</span>
        <input value={cause} onChange={(event) => setCause(event.target.value)} placeholder="Nippers raffle" />
      </label>

      <p className="counter-kicker">How much</p>
      <div className="counter-amounts">
        {DONATION_AMOUNTS.map((value) => (
          <button key={value} type="button" className={amount === value ? 'is-on' : ''} onClick={() => setAmount(value)}>
            ${value}
          </button>
        ))}
      </div>

      <p className="counter-kicker">Whose voucher</p>
      <div className="counter-venues" role="group" aria-label="Which venue the voucher is for">
        {DONATION_VENUES.map((name) => (
          <button key={name} type="button" className={venue === name ? 'is-on' : ''} aria-pressed={venue === name} onClick={() => setVenue(name)}>
            {name}
          </button>
        ))}
      </div>

      <p className="counter-kicker">
        Does it stack up? {verdict.score} of {DONATION_CRITERIA.length}
      </p>
      <div className="counter-criteria" role="group" aria-label="Donation criteria">
        {DONATION_CRITERIA.map((criterion) => (
          <button
            key={criterion.id}
            type="button"
            className={criteria[criterion.id] ? 'is-on' : ''}
            aria-pressed={criteria[criterion.id]}
            onClick={() => toggle(criterion.id)}
          >
            {criterion.label}
          </button>
        ))}
      </div>

      {verdict.warnings.map((warning) => (
        <p key={warning} className="counter-note counter-donation-warn">
          {warning}
        </p>
      ))}
      {error ? <p className="counter-error">{error}</p> : null}

      {/* Disabled until the allocation has actually come back: before it does
          this screen would be assessing against a used count of zero, and could
          offer a voucher in a year that is already spent. The server refuses it
          either way, but offering a button that cannot work is worse than
          waiting half a second for the number. */}
      <button
        type="button"
        className="counter-primary"
        disabled={busy || !allocation || !verdict.ok}
        onClick={() => void give()}
      >
        {busy ? 'Issuing…' : `Give ${money(amount * 100)}`}
      </button>
    </main>
  );
}
