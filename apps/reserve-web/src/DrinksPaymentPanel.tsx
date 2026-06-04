import { useEffect, useRef, useState } from 'react';
import { loadStripe, type Stripe, type StripeElements } from '@stripe/stripe-js';
import type { ReserveDrinksPaymentIntentResponse } from '@alma/shared';
import { api } from './lib/api';

export type DrinkPackageOption = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
};

export type DrinksPaidSummary = {
  totalCents: number;
  items: Array<{ name: string; qty: number; priceCents: number }>;
};

function formatAud(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Reusable "select drinks packages → pay" panel, shared by the public booking
// widget and the manager booking form. Charges the card now (a PaymentIntent
// from /public-widget/drinks-payment-intent) via the Stripe Payment Element —
// inline, no redirect — then hands the paid paymentIntentId back so the caller
// can create the booking with the drinks attached.
export function DrinksPaymentPanel({
  venue,
  packages,
  guestEmail,
  onPaid,
  title = 'Pre-pay for drinks',
  subtitle = 'Add drinks now and they’ll be ready on arrival — optional.'
}: {
  venue: string;
  packages: DrinkPackageOption[];
  guestEmail?: string;
  onPaid: (paymentIntentId: string, summary: DrinksPaidSummary) => void;
  title?: string;
  subtitle?: string;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<'select' | 'pay'>('select');
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);

  const selected = packages.map((p) => ({ ...p, qty: qty[p.id] ?? 0 })).filter((p) => p.qty > 0);
  const totalCents = selected.reduce((sum, p) => sum + p.priceCents * p.qty, 0);

  function setQuantity(id: string, value: number) {
    setQty((current) => ({ ...current, [id]: Math.max(0, Math.min(50, value)) }));
  }

  async function startPayment() {
    if (!selected.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<ReserveDrinksPaymentIntentResponse>('/api/reserve/public-widget/drinks-payment-intent', {
        method: 'POST',
        body: JSON.stringify({
          venue,
          guestEmail: guestEmail || undefined,
          items: selected.map((i) => ({ packageId: i.id, qty: i.qty }))
        })
      });
      if (!res.publishableKey) throw new Error('Card payments are not configured for this venue.');
      const stripe = await loadStripe(res.publishableKey);
      if (!stripe) throw new Error('Could not load the payment form.');
      stripeRef.current = stripe;
      elementsRef.current = stripe.elements({ clientSecret: res.clientSecret });
      setPaymentIntentId(res.paymentIntentId);
      setPhase('pay');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the drinks payment.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (phase !== 'pay' || !elementsRef.current || !mountRef.current) return;
    const element = elementsRef.current.create('payment');
    element.mount(mountRef.current);
    return () => {
      try {
        element.unmount();
      } catch {
        /* already unmounted */
      }
    };
  }, [phase]);

  async function confirmPayment() {
    if (busy || !stripeRef.current || !elementsRef.current || !paymentIntentId) return;
    setBusy(true);
    setError(null);
    const { error: stripeError } = await stripeRef.current.confirmPayment({
      elements: elementsRef.current,
      redirect: 'if_required'
    });
    if (stripeError) {
      setError(stripeError.message ?? 'Payment could not be completed.');
      setBusy(false);
      return;
    }
    // Charged. Hand the paid intent back; the caller creates the booking next.
    onPaid(paymentIntentId, {
      totalCents,
      items: selected.map((i) => ({ name: i.name, qty: i.qty, priceCents: i.priceCents }))
    });
  }

  if (!packages.length) return null;

  return (
    <div className="drinks-pay">
      <div className="drinks-pay__head">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>

      {phase === 'select' ? (
        <>
          <div className="drinks-pay__list">
            {packages.map((p) => {
              const n = qty[p.id] ?? 0;
              return (
                <div key={p.id} className={`drinks-pay__item${n > 0 ? ' is-on' : ''}`}>
                  <div className="drinks-pay__item-copy">
                    <strong>{p.name}</strong>
                    {p.description ? <span>{p.description}</span> : null}
                    <em>{formatAud(p.priceCents)}</em>
                  </div>
                  <div className="drinks-pay__stepper">
                    <button type="button" onClick={() => setQuantity(p.id, n - 1)} aria-label={`Fewer ${p.name}`} disabled={n === 0}>−</button>
                    <span>{n}</span>
                    <button type="button" onClick={() => setQuantity(p.id, n + 1)} aria-label={`More ${p.name}`}>＋</button>
                  </div>
                </div>
              );
            })}
          </div>
          {error ? <div className="drinks-pay__error">{error}</div> : null}
          {selected.length > 0 ? (
            <button type="button" className="drinks-pay__cta" onClick={() => void startPayment()} disabled={busy}>
              {busy ? 'Starting…' : `Pay ${formatAud(totalCents)} for drinks`}
            </button>
          ) : (
            <p className="drinks-pay__hint">Tap ＋ to add drinks, or continue without.</p>
          )}
        </>
      ) : (
        <>
          <div className="drinks-pay__summary">
            {selected.map((i) => (
              <div key={i.id}>
                <span>{i.qty}× {i.name}</span>
                <span>{formatAud(i.priceCents * i.qty)}</span>
              </div>
            ))}
            <div className="drinks-pay__summary-total">
              <span>Total</span>
              <span>{formatAud(totalCents)}</span>
            </div>
          </div>
          <div ref={mountRef} className="drinks-pay__element" />
          {error ? <div className="drinks-pay__error">{error}</div> : null}
          <button type="button" className="drinks-pay__cta" onClick={() => void confirmPayment()} disabled={busy}>
            {busy ? 'Processing…' : `Pay ${formatAud(totalCents)}`}
          </button>
          <button type="button" className="drinks-pay__back" onClick={() => { setPhase('select'); setError(null); }} disabled={busy}>
            ← Change drinks
          </button>
        </>
      )}
    </div>
  );
}
