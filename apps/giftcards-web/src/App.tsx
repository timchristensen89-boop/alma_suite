import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthUser, GiftCard, GiftCardCheckoutResult, GiftCardOverview, GiftCardPublic } from '@alma/shared';
import {
  AppShell,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  ProductLogo,
  Select,
  Spinner,
  StatCard,
  SUITE_APPS,
  SuiteAppSwitcher,
  Textarea,
  TopBar
} from '@alma/ui';
import { withSuiteAppLinks } from './config/suiteLinks';
import { api, clearApiAuthToken, setApiAuthToken } from './lib/api';

const suiteApps = withSuiteAppLinks(SUITE_APPS);
const AMOUNTS = [5000, 10000, 15000, 20000];
const VENUES = ['Alma Avalon', 'St Alma'];

function formatCents(cents: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function statusTone(status: GiftCard['status']) {
  switch (status) {
    case 'ACTIVE':
      return 'positive';
    case 'REDEEMED':
      return 'neutral';
    case 'PENDING_PAYMENT':
      return 'warning';
    case 'CANCELLED':
    case 'EXPIRED':
    default:
      return 'danger';
  }
}

function giftCardPrintUrl(code: string) {
  return `/print?code=${encodeURIComponent(code)}`;
}

function useGiftCardAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
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

function PublicGiftCardShop() {
  const [amountCents, setAmountCents] = useState(10000);
  const [purchaserName, setPurchaserName] = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  const [paidCard, setPaidCard] = useState<GiftCardPublic | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    api<GiftCardPublic>(`/api/gift-cards/session/${encodeURIComponent(sessionId)}`)
      .then(setPaidCard)
      .catch((error) => setFeedback(error instanceof Error ? error.message : 'Could not load gift card payment.'));
  }, [sessionId]);

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      const result = await api<GiftCardCheckoutResult>('/api/gift-cards/checkout', {
        method: 'POST',
        body: JSON.stringify({
          amountCents,
          purchaserName,
          purchaserEmail,
          recipientName,
          recipientEmail,
          message,
          successUrl: `${window.location.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: window.location.origin
        })
      });
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not start Stripe checkout.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="giftcards-public-page">
      <div className="giftcards-public-shell">
        <ProductLogo appId="giftcards" size="lg" />
        {paidCard ? (
          <Card title="Gift card payment received" subtitle="Stripe has confirmed the checkout session.">
            <div className="giftcards-paid-card">
              <strong>{paidCard.code}</strong>
              <span>{formatCents(paidCard.balanceCents)} available</span>
              <Badge tone={paidCard.status === 'ACTIVE' ? 'positive' : 'warning'}>{paidCard.status.replace('_', ' ')}</Badge>
              {paidCard.emailedAt ? <small>Email sent to the purchaser and recipient.</small> : null}
              {paidCard.emailError ? <small>Email needs attention: {paidCard.emailError}</small> : null}
              <div className="giftcards-inline-actions">
                <Button type="button" variant="secondary" onClick={() => window.location.assign(giftCardPrintUrl(paidCard.code))}>Print gift card</Button>
              </div>
            </div>
          </Card>
        ) : null}
        <Card title="Buy an ALMA gift card" subtitle="Redeemable at ALMA venues. Payment is handled securely by Stripe.">
          <form className="giftcards-form" onSubmit={checkout}>
            <div className="giftcards-amounts">
              {AMOUNTS.map((amount) => (
                <button key={amount} type="button" className={amountCents === amount ? 'is-selected' : ''} onClick={() => setAmountCents(amount)}>
                  {formatCents(amount)}
                </button>
              ))}
            </div>
            <div className="form-grid two">
              <Input label="Your name" required value={purchaserName} onChange={(event) => setPurchaserName(event.currentTarget.value)} />
              <Input label="Your email" required type="email" value={purchaserEmail} onChange={(event) => setPurchaserEmail(event.currentTarget.value)} />
              <Input label="Recipient name" value={recipientName} onChange={(event) => setRecipientName(event.currentTarget.value)} />
              <Input label="Recipient email" type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.currentTarget.value)} />
            </div>
            <Textarea label="Message" rows={3} value={message} onChange={(event) => setMessage(event.currentTarget.value)} />
            {feedback ? <p className="error-text">{feedback}</p> : null}
            <Button type="submit" disabled={submitting}>{submitting ? 'Opening Stripe...' : `Pay ${formatCents(amountCents)}`}</Button>
          </form>
        </Card>
        <a className="giftcards-staff-link" href="/redeem">Staff redeem</a>
      </div>
    </main>
  );
}

function PrintableGiftCardPage() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code') ?? '';
  const sessionId = params.get('session_id') ?? '';
  const [card, setCard] = useState<GiftCardPublic | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const endpoint = sessionId
      ? `/api/gift-cards/session/${encodeURIComponent(sessionId)}`
      : `/api/gift-cards/print/${encodeURIComponent(code)}`;
    if (!sessionId && !code) {
      setMessage('Gift card code is missing.');
      return;
    }
    api<GiftCardPublic>(endpoint)
      .then(setCard)
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load printable gift card.'));
  }, [code, sessionId]);

  return (
    <main className="giftcards-print-page">
      <div className="giftcards-print-actions">
        <Button type="button" variant="secondary" onClick={() => window.location.assign('/')}>Back</Button>
        <Button type="button" onClick={() => window.print()} disabled={!card}>Print / save PDF</Button>
      </div>
      {message ? <p className="error-text">{message}</p> : null}
      {card ? (
        <section className="giftcards-print-card">
          <div className="giftcards-print-brand">ALMA Gift Cards</div>
          <h1>{formatCents(card.balanceCents)}</h1>
          <p>Redeemable at ALMA venues</p>
          <div className="giftcards-print-code">{card.code}</div>
          {card.recipientName ? <p>For {card.recipientName}</p> : null}
          {card.message ? <blockquote>{card.message}</blockquote> : null}
          <footer>
            <span>Status: {card.status.replace('_', ' ')}</span>
            {card.expiresAt ? <span>Expires {new Date(card.expiresAt).toLocaleDateString('en-AU')}</span> : null}
          </footer>
        </section>
      ) : null}
    </main>
  );
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
        <ProductLogo appId="giftcards" size="lg" />
        <Card title="Staff redeem" subtitle="Manager sign in required to accept gift cards">
          <form className="login-form" onSubmit={handleSubmit}>
            <Input label="Email" type="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
            <Input label="Password" type="password" required value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
            {message ? <p className="error-text">{message}</p> : null}
            <Button type="submit" disabled={submitting}>{submitting ? 'Signing in...' : 'Sign in'}</Button>
          </form>
        </Card>
        <SuiteAppSwitcher currentApp="giftcards" apps={suiteApps} />
      </div>
    </main>
  );
}

function GiftCardDashboard({ onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const [data, setData] = useState<GiftCardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [venue, setVenue] = useState(VENUES[0]);
  const [notes, setNotes] = useState('');
  const [selectedCard, setSelectedCard] = useState<GiftCard | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [refundNote, setRefundNote] = useState('');

  const giftCards = data?.giftCards ?? [];
  const selectedFromList = useMemo(
    () => giftCards.find((card) => card.code.toLowerCase() === code.trim().toLowerCase()) ?? null,
    [code, giftCards]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const params = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : '';
      setData(await api<GiftCardOverview>(`/api/gift-cards/cards${params}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load gift cards.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      setSelectedCard(await api<GiftCard>(`/api/gift-cards/cards/${encodeURIComponent(code.trim())}`));
    } catch (error) {
      setSelectedCard(null);
      setMessage(error instanceof Error ? error.message : 'Gift card not found.');
    }
  }

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      const updated = await api<GiftCard>('/api/gift-cards/redeem', {
        method: 'POST',
        body: JSON.stringify({
          code,
          amountCents: Math.round(Number(amount) * 100),
          venue,
          notes
        })
      });
      setSelectedCard(updated);
      setAmount('');
      setNotes('');
      setMessage(`Redeemed ${formatCents(updated.initialValueCents - updated.balanceCents)} total. Remaining balance ${formatCents(updated.balanceCents)}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not redeem gift card.');
    }
  }

  async function cancelCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!card) return;
    setMessage(null);
    try {
      const updated = await api<GiftCard>(`/api/gift-cards/cards/${encodeURIComponent(card.code)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          reason: cancelReason,
          refundNote
        })
      });
      setSelectedCard(updated);
      setCancelReason('');
      setRefundNote('');
      setMessage('Gift card cancelled. Stripe refund, if needed, still needs to be handled in Stripe.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not cancel gift card.');
    }
  }

  const card = selectedCard ?? selectedFromList;

  return (
    <AppShell
      brand={<ProductLogo appId="giftcards" size="md" showBrandMark={false} />}
      sidebar={<div className="sidebar-nav" />}
      topBar={
        <TopBar
          title="ALMA Gift Cards"
          subtitle="Sell, check balances, and redeem cards"
          right={
            <>
              <SuiteAppSwitcher currentApp="giftcards" apps={suiteApps} variant="topbar" />
              <Button type="button" variant="secondary" onClick={() => void onLogout()}>Sign out</Button>
            </>
          }
        />
      }
    >
      <div className="giftcards-page">
        <PageHeader
          eyebrow="ALMA Gift Cards"
          title="Gift card register"
          description="Stripe-confirmed cards become active here. Staff can check the code, confirm the balance, and redeem against a venue."
          actions={<Input label="Search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Code, name, email" />}
        />
        {message ? <p className={message.includes('Could') || message.includes('not') || message.includes('low') ? 'error-text' : 'subtle'}>{message}</p> : null}
        <div className="stats-grid">
          <StatCard label="Active" value={data?.totals.active ?? 0} hint="Can be redeemed" loading={loading} />
          <StatCard label="Pending" value={data?.totals.pending ?? 0} hint="Waiting for Stripe" loading={loading} />
          <StatCard label="Balance" value={formatCents(data?.totals.activeBalanceCents ?? 0)} hint="Outstanding liability" loading={loading} />
          <StatCard label="Sold" value={formatCents(data?.totals.soldValueCents ?? 0)} hint="Stripe-confirmed value" loading={loading} />
        </div>
        <div className="giftcards-layout">
          <Card title="Redeem gift card" subtitle="Enter the customer code and redeem only the amount used.">
            <form className="giftcards-form" onSubmit={(event) => void lookup(event)}>
              <Input label="Gift card code" required value={code} onChange={(event) => setCode(event.currentTarget.value.toUpperCase())} placeholder="ALMA-XXXXXXXX" />
              <Button type="submit" variant="secondary">Check balance</Button>
            </form>
            {card ? (
              <form className="giftcards-form" onSubmit={(event) => void redeem(event)}>
                <div className="giftcards-balance-card">
                  <strong>{card.code}</strong>
                  <span>{formatCents(card.balanceCents)} remaining of {formatCents(card.initialValueCents)}</span>
                  <Badge tone={statusTone(card.status)}>{card.status.replace('_', ' ')}</Badge>
                  {card.emailedAt ? <small>Email sent {new Date(card.emailedAt).toLocaleString('en-AU')}</small> : null}
                  {card.emailError ? <small>Email issue: {card.emailError}</small> : null}
                  {card.cancelReason ? <small>Cancel note: {card.cancelReason}</small> : null}
                </div>
                <div className="form-grid two">
                  <Input label="Redeem amount" required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} />
                  <Select label="Venue" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} options={VENUES.map((item) => ({ label: item, value: item }))} />
                </div>
                <Textarea label="Notes" rows={2} value={notes} onChange={(event) => setNotes(event.currentTarget.value)} />
                <div className="giftcards-inline-actions">
                  <Button type="submit" disabled={!card || card.status !== 'ACTIVE'}>Redeem</Button>
                  <Button type="button" variant="secondary" onClick={() => window.open(giftCardPrintUrl(card.code), '_blank')}>Print</Button>
                </div>
              </form>
            ) : null}
            {card && card.status !== 'CANCELLED' && card.status !== 'EXPIRED' ? (
              <form className="giftcards-form giftcards-cancel-form" onSubmit={(event) => void cancelCard(event)}>
                <Textarea label="Void / cancellation reason" required rows={2} value={cancelReason} onChange={(event) => setCancelReason(event.currentTarget.value)} />
                <Textarea label="Refund note" rows={2} value={refundNote} onChange={(event) => setRefundNote(event.currentTarget.value)} placeholder="Example: refunded in Stripe dashboard, left as store credit, manager comp" />
                <Button type="submit" variant="danger">Cancel card</Button>
              </form>
            ) : null}
          </Card>
          <Card title="Recent cards" subtitle="Latest sales and balances" padding="none">
            {loading ? <Spinner label="Loading gift cards..." /> : null}
            {!loading && giftCards.length === 0 ? <EmptyState title="No gift cards yet" description="Paid Stripe checkouts will appear here." /> : null}
            <div className="giftcards-list">
              {giftCards.map((item) => (
                <button key={item.id} type="button" onClick={() => { setCode(item.code); setSelectedCard(item); }}>
                  <span>
                    <strong>{item.code}</strong>
                    <small>{item.recipientName || item.purchaserName} · {item.purchaserEmail}</small>
                  </span>
                  <span>
                    <strong>{formatCents(item.balanceCents)}</strong>
                    <Badge tone={statusTone(item.status)}>{item.status.replace('_', ' ')}</Badge>
                  </span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

export function App() {
  const auth = useGiftCardAuth();
  const isRedeemPath = window.location.pathname.startsWith('/redeem');
  const isPrintPath = window.location.pathname.startsWith('/print');

  if (isPrintPath) return <PrintableGiftCardPage />;
  if (!isRedeemPath) return <PublicGiftCardShop />;
  if (auth.loading) return <div className="login-page"><Spinner label="Checking session" /></div>;
  if (!auth.user) return <LoginScreen onLogin={auth.login} />;
  return <GiftCardDashboard user={auth.user} onLogout={auth.logout} />;
}
