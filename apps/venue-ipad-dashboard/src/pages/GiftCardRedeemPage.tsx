// Phase 5.5: Venue iPad — real Gift Card Redeem flow.
//
// Strategy doc flagged this as the single most important venue action.
// Flow: enter/scan code → look up balance → redeem an amount → confirm.
//
// Auth reality: both lookup (GET /cards/:code) and redeem (POST /redeem)
// are manager-only on the API — gift cards are money and were hardened
// in Phase 0. The tile is already behind a staff PIN (Phase 5.4); if the
// signed-in staff member isn't a manager the API returns 403 and we show
// a clear "a manager must be signed in" state with a Switch button,
// rather than a raw error.
//
// A fallback instruction is always visible so service never stalls on
// software: write the code + amount, charge as cash on Square, reconcile
// with the manager after.

import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GiftCard } from '@alma/shared';
import { api, ApiRequestError, messageForError } from '../api';
import { AppShell, type PageShellProps, type Venue } from '../shell';

type Props = Omit<PageShellProps, 'requirePin'> & { venue: Venue };

const VENUE_API_NAMES: Record<string, string> = {
  'st-alma': 'St Alma',
  'alma-avalon': 'Alma Avalon'
};

function dollars(cents: number): string {
  return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase();
}

// Keep only digits and a single decimal point, capped at 2 decimal places.
// Visual-only $ prefix lives in the markup, so it never appears in the value.
function sanitiseAmount(raw: string): string {
  let cleaned = raw.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    const intPart = cleaned.slice(0, firstDot);
    const decPart = cleaned.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
    cleaned = `${intPart}.${decPart}`;
  }
  return cleaned;
}

export function GiftCardRedeemPage({ venue, auth, onRequestStaffPin, onSwitchStaff }: Props) {
  const venueApiName = VENUE_API_NAMES[venue.id] ?? null;

  const [code, setCode] = useState('');
  const [card, setCard] = useState<GiftCard | null>(null);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState('');
  const [amountError, setAmountError] = useState('');
  const [managerRequired, setManagerRequired] = useState(false);
  const [success, setSuccess] = useState<{ redeemed: number; balance: number } | null>(null);

  const reset = useCallback(() => {
    setCode('');
    setCard(null);
    setAmount('');
    setError('');
    setAmountError('');
    setManagerRequired(false);
    setSuccess(null);
  }, []);

  const lookup = useCallback(async () => {
    const clean = normaliseCode(code);
    if (clean.length < 4) {
      setError('Enter the full gift card code.');
      return;
    }
    setLoading(true);
    setError('');
    setManagerRequired(false);
    setSuccess(null);
    try {
      const found = await api<GiftCard>(`/api/gift-cards/cards/${encodeURIComponent(clean)}`);
      setCard(found);
      setCode(found.code);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 403) {
        setManagerRequired(true);
      } else if (e instanceof ApiRequestError && e.status === 404) {
        setError('No gift card found for that code, or its payment is unconfirmed.');
      } else if (e instanceof ApiRequestError && e.status >= 500) {
        setError('Network error — tap Look up to try again.');
      } else {
        setError(messageForError(e, 'Could not look up that gift card.'));
      }
    } finally {
      setLoading(false);
    }
  }, [code]);

  const redeem = useCallback(async () => {
    if (!card) return;
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError('Enter an amount to redeem.');
      return;
    }
    if (amountCents > card.balanceCents) {
      setError(`Amount is more than the ${dollars(card.balanceCents)} balance.`);
      return;
    }
    setRedeeming(true);
    setError('');
    setAmountError('');
    try {
      const updated = await api<GiftCard>('/api/gift-cards/redeem', {
        method: 'POST',
        body: JSON.stringify({
          code: card.code,
          amountCents,
          venue: venueApiName ?? undefined
        })
      });
      setSuccess({ redeemed: amountCents, balance: updated.balanceCents });
      setCard(updated);
      setAmount('');
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 403) {
        setManagerRequired(true);
      } else {
        setError(messageForError(e, 'Could not redeem the gift card.'));
      }
    } finally {
      setRedeeming(false);
    }
  }, [amount, card, venueApiName]);

  const fallback = (
    <div className="preview-panel gift-fallback">
      <p className="preview-eyebrow">If this fails during service</p>
      <p>
        Write down the card code and the amount, charge it as cash on Square so the guest isn't
        held up, and hand the note to the manager to reconcile after service.
      </p>
    </div>
  );

  return (
    <AppShell
      venue={venue}
      auth={auth}
      onRequestStaffPin={onRequestStaffPin}
      onSwitchStaff={onSwitchStaff}
    >
      <section className="page-stack">
        <div className="section-block">
          <div className="section-header">
            <div>
              <p className="eyebrow">{venue.name}</p>
              <h2>Gift card redeem</h2>
            </div>
            <Link className="button secondary" to={`/venue/${venue.id}`}>
              Back to venue
            </Link>
          </div>
          <p className="section-copy">
            Scan or type the gift card code to check the balance and redeem against a bill.
          </p>
        </div>

        {managerRequired ? (
          <div className="section-block gift-manager-required">
            <p className="eyebrow">Manager sign-in needed</p>
            <h2>A manager must be signed in to redeem gift cards</h2>
            <p className="section-copy">
              Gift cards are money, so redeeming is manager-only. Tap below to switch to a
              manager's PIN, then try again.
            </p>
            <button type="button" className="button" onClick={onSwitchStaff}>
              Switch to a manager
            </button>
          </div>
        ) : null}

        {/* Code lookup */}
        <div className="section-block">
          <label className="gift-field">
            <span>Gift card code</span>
            <div className="gift-code-row">
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="gift-code-input"
                value={code}
                placeholder="Scan or type code"
                onChange={(e) => setCode(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void lookup();
                }}
                disabled={loading}
              />
              <button
                type="button"
                className="button"
                onClick={() => void lookup()}
                disabled={loading}
              >
                {loading ? 'Looking up…' : 'Look up'}
              </button>
            </div>
          </label>
          {error && !card ? <p className="device-signin-error">{error}</p> : null}
        </div>

        {/* Card detail + redeem */}
        {card ? (
          <div className="section-block gift-card-panel">
            <div className="gift-card-balance">
              <span className="gift-card-balance-eyebrow">Balance</span>
              <strong className={`gift-card-balance-value is-${card.status.toLowerCase()}`}>
                {dollars(card.balanceCents)}
              </strong>
              <span className={`status-pill ${card.status === 'ACTIVE' ? 'positive' : 'neutral'}`}>
                {card.status.replace('_', ' ').toLowerCase()}
              </span>
            </div>
            <p className="gift-card-meta">
              Card {card.code} · started at {dollars(card.initialValueCents)}
            </p>

            {success ? (
              <div className="gift-success">
                <strong>Redeemed {dollars(success.redeemed)}</strong>
                <span>New balance {dollars(success.balance)}</span>
              </div>
            ) : null}

            {card.status === 'ACTIVE' && card.balanceCents > 0 ? (
              <>
                <label className="gift-field">
                  <span>Amount to redeem</span>
                  <div className="gift-amount-row">
                    <span className="gift-amount-prefix">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="gift-amount-input"
                      value={amount}
                      placeholder="0.00"
                      onChange={(e) => {
                        setAmountError('');
                        setAmount(sanitiseAmount(e.currentTarget.value));
                      }}
                      onBlur={() => {
                        if (amount === '') return;
                        const value = Number(amount);
                        if (!Number.isFinite(value) || value <= 0) {
                          setAmountError('Enter a valid amount.');
                          return;
                        }
                        setAmount(value.toFixed(2));
                      }}
                      disabled={redeeming}
                    />
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setAmount((card.balanceCents / 100).toFixed(2))}
                      disabled={redeeming}
                    >
                      Full balance
                    </button>
                  </div>
                </label>
                {amountError ? <p className="device-signin-error">{amountError}</p> : null}
                {error ? <p className="device-signin-error">{error}</p> : null}
                <button
                  type="button"
                  className="button gift-redeem-btn"
                  onClick={() => void redeem()}
                  disabled={redeeming || !amount}
                >
                  {redeeming ? 'Redeeming…' : `Redeem${amount ? ` ${dollars(Math.round(Number(amount) * 100) || 0)}` : ''}`}
                </button>
              </>
            ) : (
              <p className="section-copy">
                {card.balanceCents === 0
                  ? 'This card has no balance left.'
                  : `This card is ${card.status.replace('_', ' ').toLowerCase()} and cannot be redeemed.`}
              </p>
            )}

            <button type="button" className="button secondary gift-reset-btn" onClick={reset}>
              Look up another card
            </button>
          </div>
        ) : null}

        {fallback}
      </section>
    </AppShell>
  );
}
