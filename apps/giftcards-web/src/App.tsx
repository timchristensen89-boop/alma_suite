import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthUser, GiftCard, GiftCardCheckoutResult, GiftCardOverview, GiftCardPublic } from '@alma/shared';
import {
  AppShell,
  Badge,
  Button,
  Card,
  ChartIcon,
  DocumentIcon,
  EmptyState,
  Input,
  PageHeader,
  ProductLogo,
  SearchIcon,
  Select,
  Spinner,
  StatCard,
  SUITE_APPS,
  SuiteAppSwitcher,
  Textarea,
  TopBar
} from '@alma/ui';
import { withSuiteAppLinks } from './config/suiteLinks';
import { API_BASE_URL, api, clearApiAuthToken, consumeSuiteHandoffToken, installSuiteHandoff, setApiAuthToken } from './lib/api';

const suiteApps = withSuiteAppLinks(SUITE_APPS);
const AMOUNTS = [
  { amountCents: 5000, title: 'Margaritas and tacos', note: 'A round, a few plates, a very easy thank you.' },
  { amountCents: 10000, title: 'Dinner for two', note: 'A simple way to send someone out for dinner.' },
  { amountCents: 15000, title: 'Long lunch', note: 'For a long lunch that has room to roll on.' },
  { amountCents: 20000, title: 'A celebration', note: 'For birthdays, milestones and bigger tables.' }
];
const VENUES = ['Alma Avalon', 'St Alma'];
const GIFTCARD_NAV_ITEMS = [
  {
    href: '#redeem',
    label: 'Redeem',
    description: 'Check and redeem',
    icon: <SearchIcon />
  },
  {
    href: '#recent',
    label: 'Cards',
    description: 'Recent sales',
    icon: <DocumentIcon />
  },
  {
    href: '/',
    label: 'Public shop',
    description: 'Buy gift card page',
    icon: <ChartIcon />
  }
];

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

function apiPath(path: string) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (API_BASE_URL.endsWith('/api') && cleanPath.startsWith('/api/')) return cleanPath.slice(4);
  return cleanPath;
}

function giftCardAppleWalletUrl(code: string) {
  return `${API_BASE_URL}${apiPath(`/api/gift-cards/wallet/apple/${encodeURIComponent(code)}`)}`;
}

function giftCardGoogleWalletUrl(code: string) {
  return `${API_BASE_URL}${apiPath(`/api/gift-cards/wallet/google/${encodeURIComponent(code)}`)}`;
}

function WalletButtons({ card, onMessage }: { card: GiftCardPublic; onMessage?: (message: string | null) => void }) {
  const canAddToWallet = card.status === 'ACTIVE' && card.balanceCents > 0;

  if (!canAddToWallet) return null;

  return (
    <div className="giftcards-wallet-actions" aria-label="Add gift card to wallet">
      <a
        className="giftcards-wallet-button giftcards-wallet-button-apple"
        href={giftCardAppleWalletUrl(card.code)}
        onClick={() => onMessage?.(null)}
      >
        Add to Apple Wallet
      </a>
      <a
        className="giftcards-wallet-button giftcards-wallet-button-google"
        href={giftCardGoogleWalletUrl(card.code)}
        onClick={() => onMessage?.(null)}
      >
        Add to Google Wallet
      </a>
    </div>
  );
}

function useGiftCardAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const handoffUser = await consumeSuiteHandoffToken();
      if (handoffUser) {
        setUser(handoffUser);
        return;
      }
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

  useEffect(() => installSuiteHandoff(), []);

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
  const [customAmount, setCustomAmount] = useState('');
  const [purchaserName, setPurchaserName] = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  const [paidCard, setPaidCard] = useState<GiftCardPublic | null>(null);
  const selectedGift = AMOUNTS.find((gift) => gift.amountCents === amountCents);
  const amountError = amountCents < 1000 || amountCents > 200000
    ? 'Choose an amount between $10 and $2,000.'
    : null;

  useEffect(() => {
    if (!sessionId) return;
    api<GiftCardPublic>(`/api/gift-cards/session/${encodeURIComponent(sessionId)}`)
      .then(setPaidCard)
      .catch((error) => setFeedback(error instanceof Error ? error.message : 'Could not load gift card payment.'));
  }, [sessionId]);

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (amountError) {
      setFeedback(amountError);
      return;
    }
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

  function chooseAmount(cents: number) {
    setAmountCents(cents);
    setCustomAmount('');
  }

  function updateCustomAmount(value: string) {
    setCustomAmount(value);
    const dollars = Number(value);
    if (Number.isFinite(dollars)) {
      setAmountCents(Math.round(dollars * 100));
    }
  }

  return (
    <main className="giftcards-public-page">
      <header className="giftcards-public-header">
        <a href="https://almagroup.com.au/" aria-label="Alma Group home">
          <img src="/images/alma-group-logo.png" alt="Alma Group" />
        </a>
        <nav aria-label="Alma Group">
          <a href="https://almagroup.com.au/menu">Menus</a>
          <a href="https://almagroup.com.au/book">Book</a>
          <a href="https://almagroup.com.au/contact">Contact</a>
        </nav>
      </header>
      <div className="giftcards-public-shell">
        {paidCard ? (
          <section className="giftcards-public-panel giftcards-public-success" aria-label="Gift card payment received">
            <div>
              <p className="giftcards-public-eyebrow">Payment received</p>
              <h2>Your gift card is ready.</h2>
              <p>Stripe has confirmed the payment. The code below is ready to use at Alma Avalon and St Alma.</p>
            </div>
            <div className="giftcards-paid-card">
              <strong>{paidCard.code}</strong>
              <span>{formatCents(paidCard.balanceCents)} available</span>
              <Badge tone={paidCard.status === 'ACTIVE' ? 'positive' : 'warning'}>{paidCard.status.replace('_', ' ')}</Badge>
              {paidCard.emailedAt ? <small>Email sent to the purchaser and recipient.</small> : null}
              {paidCard.emailError ? <small>Email needs attention: {paidCard.emailError}</small> : null}
              <div className="giftcards-inline-actions">
                <button type="button" className="giftcards-public-secondary" onClick={() => window.location.assign(giftCardPrintUrl(paidCard.code))}>Print gift card</button>
              </div>
              <WalletButtons card={paidCard} onMessage={setFeedback} />
            </div>
          </section>
        ) : null}
        <section className="giftcards-public-hero">
          <div className="giftcards-public-copy">
            <p className="giftcards-public-eyebrow">Alma Group gift cards</p>
            <h1>Gift a good table.</h1>
            <p>
              Send lunch, dinner, margaritas or a celebration across Alma Avalon and St Alma.
              Choose a set amount or enter your own.
            </p>
            <div className="giftcards-public-links">
              <a href="https://almagroup.com.au/book">Book a table</a>
              <a href="https://almagroup.com.au/menu">View menus</a>
            </div>
          </div>
          <div className="giftcards-public-image" aria-hidden="true">
            <img src="/images/alma-avalon-margaritas.jpg" alt="" />
          </div>
        </section>

        <section className="giftcards-public-grid">
          <div className="giftcards-public-amounts" aria-label="Gift card amounts">
            {AMOUNTS.map((gift) => (
              <button
                key={gift.amountCents}
                type="button"
                className={amountCents === gift.amountCents && customAmount === '' ? 'is-selected' : ''}
                onClick={() => chooseAmount(gift.amountCents)}
              >
                <span>Alma Group</span>
                <strong>{formatCents(gift.amountCents)}</strong>
                <em>{gift.title}</em>
                <small>{gift.note}</small>
              </button>
            ))}
            <label className={`giftcards-custom-amount ${customAmount ? 'is-selected' : ''}`}>
              <span>Custom amount</span>
              <strong>{customAmount ? formatCents(amountCents) : 'Your choice'}</strong>
              <small>Enter any amount from $10 to $2,000.</small>
              <input
                type="number"
                min="10"
                max="2000"
                step="1"
                value={customAmount}
                onChange={(event) => updateCustomAmount(event.currentTarget.value)}
                placeholder="125"
              />
            </label>
          </div>

          <form className="giftcards-public-form" onSubmit={checkout}>
            <div className="giftcards-form-heading">
              <p className="giftcards-public-eyebrow">Secure checkout</p>
              <h2>{selectedGift ? selectedGift.title : 'Custom gift card'}</h2>
              <p>{selectedGift?.note ?? 'A flexible Alma Group gift card for whatever table they choose.'}</p>
              <strong>{formatCents(amountCents)}</strong>
            </div>
            <div className="giftcards-public-fields">
              <label>
                <span>Your name</span>
                <input required value={purchaserName} onChange={(event) => setPurchaserName(event.currentTarget.value)} />
              </label>
              <label>
                <span>Your email</span>
                <input required type="email" value={purchaserEmail} onChange={(event) => setPurchaserEmail(event.currentTarget.value)} />
              </label>
              <label>
                <span>Recipient name</span>
                <input value={recipientName} onChange={(event) => setRecipientName(event.currentTarget.value)} />
              </label>
              <label>
                <span>Recipient email</span>
                <input type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.currentTarget.value)} />
              </label>
              <label className="giftcards-public-message">
                <span>Message</span>
                <textarea rows={3} value={message} onChange={(event) => setMessage(event.currentTarget.value)} />
              </label>
            </div>
            {feedback || amountError ? <p className="giftcards-public-error">{feedback ?? amountError}</p> : null}
            <button className="giftcards-public-submit" type="submit" disabled={submitting || Boolean(amountError)}>
              {submitting ? 'Opening Stripe...' : `Pay ${formatCents(amountCents)}`}
            </button>
          </form>
        </section>
        <section className="giftcards-public-notes">
          <div>
            <img src="/images/fish.png" alt="" />
            <strong>Redeem across venues</strong>
            <span>Alma Avalon and St Alma Freshwater.</span>
          </div>
          <div>
            <img src="/images/fish.png" alt="" />
            <strong>Delivered by email</strong>
            <span>Only after Stripe confirms payment.</span>
          </div>
          <div>
            <img src="/images/fish.png" alt="" />
            <strong>Easy to print</strong>
            <span>Use the printable gift card after checkout.</span>
          </div>
        </section>
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
          <WalletButtons card={card} onMessage={setMessage} />
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

function SidebarNav() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeHash, setActiveHash] = useState('#redeem');

  useEffect(() => {
    const syncHash = () => setActiveHash(window.location.hash || '#redeem');
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  const active = GIFTCARD_NAV_ITEMS.find((item) => item.href === activeHash) ?? GIFTCARD_NAV_ITEMS[0]!;

  return (
    <>
      <button
        className="mobile-nav-toggle"
        type="button"
        aria-expanded={mobileMenuOpen}
        aria-controls="giftcards-mobile-nav"
        onClick={() => setMobileMenuOpen((open) => !open)}
      >
        <span className="mobile-nav-toggle-current">
          <span className="sidebar-nav-icon">{active.icon}</span>
          <span>{active.label}</span>
        </span>
        <span className="mobile-nav-toggle-caret" aria-hidden="true">⌄</span>
      </button>
      <ul
        id="giftcards-mobile-nav"
        className={`sidebar-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}
      >
        <li className="sidebar-nav-section">Gift Cards</li>
        {GIFTCARD_NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              className={activeHash === item.href ? 'active' : ''}
              onClick={() => {
                setActiveHash(item.href);
                setMobileMenuOpen(false);
              }}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </>
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
      sidebar={<SidebarNav />}
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
          <StatCard label="Redeemed" value={data?.totals.redeemed ?? 0} hint="Fully used" loading={loading} />
          <StatCard label="Balance" value={formatCents(data?.totals.activeBalanceCents ?? 0)} hint="Outstanding liability" loading={loading} />
          <StatCard label="Sold" value={formatCents(data?.totals.soldValueCents ?? 0)} hint="Stripe-confirmed value" loading={loading} />
        </div>
        <div className="giftcards-layout">
          <div id="redeem">
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
          </div>
          <div id="recent">
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
