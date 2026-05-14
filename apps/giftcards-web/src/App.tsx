import { type CSSProperties, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_GIFT_CARD_SETTINGS,
  type AuthUser,
  type GiftCard,
  type GiftCardAdminSettingsResponse,
  type GiftCardCheckoutResult,
  type GiftCardOverview,
  type GiftCardPromoCode,
  type GiftCardPromoQuote,
  type GiftCardPublicConfig,
  type GiftCardPublic,
  type GiftCardSettings
} from '@alma/shared';
import {
  AppShell,
  ActionFeedback,
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
  SuiteCommsWidget,
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
    href: '/',
    label: 'Shop',
    description: 'Public purchase page',
    icon: <ChartIcon />
  },
  {
    href: '/orders#recent',
    label: 'Orders',
    description: 'Recent cards and balances',
    icon: <DocumentIcon />
  },
  {
    href: '/redeem#redeem',
    label: 'Redeem',
    description: 'Check and redeem',
    icon: <SearchIcon />
  },
  {
    href: '/admin#settings',
    label: 'Admin setup',
    description: 'Checkout, promos, artwork',
    icon: <ChartIcon />
  }
];

function formatCents(cents: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function themeStyle(settings: GiftCardSettings): CSSProperties {
  return {
    '--giftcards-primary': settings.primaryColor,
    '--giftcards-accent': settings.accentColor
  } as CSSProperties;
}

function imageToDataUrl(file: File) {
  if (file.size > 4 * 1024 * 1024) {
    return Promise.reject(new Error('Use an image smaller than 4MB.'));
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
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
  const [settings, setSettings] = useState<GiftCardSettings>(DEFAULT_GIFT_CARD_SETTINGS);
  const [checkoutMode, setCheckoutMode] = useState<'live' | 'test' | 'setup_required'>('setup_required');
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  const [amountCents, setAmountCents] = useState(10000);
  const [customAmount, setCustomAmount] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoQuote, setPromoQuote] = useState<GiftCardPromoQuote | null>(null);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [applyingPromo, setApplyingPromo] = useState(false);
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
  const amountDueCents = promoQuote ? promoQuote.amountDueCents : amountCents;
  const amountError = amountCents < 1000 || amountCents > 200000
    ? 'Choose an amount between $10 and $2,000.'
    : null;
  const checkoutBlocked = checkoutMode === 'setup_required';

  useEffect(() => {
    api<GiftCardPublicConfig>('/api/gift-cards/public/config')
      .then((config) => {
        setSettings(config.settings);
        setCheckoutMode(config.checkoutMode);
        setCheckoutNotice(config.checkoutNotice);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    api<GiftCardPublic>(`/api/gift-cards/session/${encodeURIComponent(sessionId)}`)
      .then(setPaidCard)
      .catch((error) => setFeedback(error instanceof Error ? error.message : 'Could not load gift card payment.'));
  }, [sessionId]);

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checkoutBlocked) {
      setFeedback(checkoutNotice ?? 'Payment setup is required before gift card checkout can go live.');
      return;
    }
    if (amountError) {
      setFeedback(amountError);
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const result = await api<GiftCardCheckoutResult>('/api/gift-cards/public/orders', {
        method: 'POST',
        body: JSON.stringify({
          amountCents,
          promoCode: promoQuote?.code ?? promoCode.trim(),
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
      setFeedback(error instanceof Error ? error.message : 'Could not start gift card checkout.');
    } finally {
      setSubmitting(false);
    }
  }

  function chooseAmount(cents: number) {
    setAmountCents(cents);
    setCustomAmount('');
    setPromoQuote(null);
    setPromoMessage(null);
  }

  function updateCustomAmount(value: string) {
    setCustomAmount(value);
    setPromoQuote(null);
    setPromoMessage(null);
    const dollars = Number(value);
    if (Number.isFinite(dollars)) {
      setAmountCents(Math.round(dollars * 100));
    }
  }

  async function applyPromoCode() {
    const code = promoCode.trim();
    if (!code) {
      setPromoQuote(null);
      setPromoMessage('Enter a promo code first.');
      return;
    }
    setApplyingPromo(true);
    setPromoMessage(null);
    try {
      const quote = await api<GiftCardPromoQuote>('/api/gift-cards/promo/quote', {
        method: 'POST',
        body: JSON.stringify({ code, amountCents })
      });
      setPromoQuote(quote);
      setPromoCode(quote.code);
      setPromoMessage(`${quote.code} applied: ${formatCents(quote.discountCents)} off.`);
    } catch (error) {
      setPromoQuote(null);
      setPromoMessage(error instanceof Error ? error.message : 'Promo code could not be applied.');
    } finally {
      setApplyingPromo(false);
    }
  }

  return (
    <main className="giftcards-public-page" style={themeStyle(settings)}>
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
              <p className="giftcards-public-eyebrow">{paidCard.testMode ? 'Test checkout complete' : 'Payment received'}</p>
              <h2>Your gift card is ready.</h2>
              <p>{paidCard.testMode ? 'Test mode created this card without taking a Stripe payment.' : 'Stripe has confirmed the payment. The code below is ready to use at Alma Avalon and St Alma.'}</p>
            </div>
            <div className="giftcards-paid-card">
              <strong>{paidCard.code}</strong>
              <span>{formatCents(paidCard.balanceCents)} available</span>
              <Badge tone={paidCard.status === 'ACTIVE' ? 'positive' : 'warning'}>{paidCard.status.replace('_', ' ')}</Badge>
              {paidCard.testMode ? <Badge tone="warning">TEST MODE</Badge> : null}
              {paidCard.emailedAt ? <small>Email sent to the purchaser and recipient.</small> : null}
              {paidCard.emailError ? <small>Email needs attention: {paidCard.emailError}</small> : null}
              <img className="giftcards-qr" src={paidCard.qrCodeUrl} alt="Gift card redemption QR code" />
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
            <h1>{settings.publicHeadline}</h1>
            <p>
              {settings.publicSubheading}
            </p>
            <div className="giftcards-public-links">
              <a href="#checkout">Buy gift card</a>
              <a href="https://almagroup.com.au/book">Book a table</a>
            </div>
          </div>
          <div className="giftcards-public-image" aria-hidden="true">
            <img src={settings.heroImageUrl || DEFAULT_GIFT_CARD_SETTINGS.heroImageUrl} alt="" />
          </div>
        </section>

        {checkoutNotice ? (
          <section className="giftcards-test-banner">
            <strong>{checkoutMode === 'test' ? 'Test checkout is on.' : 'Payment setup required.'}</strong>
            <span>{checkoutNotice}</span>
          </section>
        ) : null}

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

          <form id="checkout" className="giftcards-public-form" onSubmit={checkout}>
            <div className="giftcards-form-heading">
              <p className="giftcards-public-eyebrow">Secure checkout</p>
              <h2>{selectedGift ? selectedGift.title : 'Custom gift card'}</h2>
              <p>{selectedGift?.note ?? 'A flexible Alma Group gift card for whatever table they choose.'}</p>
              <div className="giftcards-checkout-total">
                <span>Total today</span>
                <strong>{formatCents(amountDueCents)}</strong>
              </div>
              {promoQuote ? (
                <div className="giftcards-discount-line">
                  <span>{promoQuote.code}</span>
                  <strong>-{formatCents(promoQuote.discountCents)}</strong>
                </div>
              ) : null}
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
              <label className="giftcards-promo-field">
                <span>Promo code</span>
                <div>
                  <input value={promoCode} onChange={(event) => { setPromoCode(event.currentTarget.value.toUpperCase()); setPromoQuote(null); setPromoMessage(null); }} placeholder="ALMA10" />
                  <button type="button" onClick={() => void applyPromoCode()} disabled={applyingPromo || Boolean(amountError)}>
                    {applyingPromo ? 'Checking...' : 'Apply'}
                  </button>
                </div>
              </label>
            </div>
            {promoMessage ? <p className={promoQuote ? 'giftcards-public-note' : 'giftcards-public-error'}>{promoMessage}</p> : null}
            {feedback || amountError ? <p className="giftcards-public-error">{feedback ?? amountError}</p> : null}
            <button className="giftcards-public-submit" type="submit" disabled={submitting || Boolean(amountError) || checkoutBlocked}>
              {checkoutBlocked
                ? 'Payment setup required'
                : submitting
                  ? (checkoutMode === 'test' ? 'Creating test card...' : 'Opening checkout...')
                  : checkoutMode === 'test'
                    ? `Create test card (${formatCents(amountDueCents)})`
                    : `Pay ${formatCents(amountDueCents)}`}
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
  const [settings, setSettings] = useState<GiftCardSettings>(DEFAULT_GIFT_CARD_SETTINGS);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api<GiftCardSettings>('/api/gift-cards/settings/public')
      .then(setSettings)
      .catch(() => undefined);
  }, []);

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
    <main className="giftcards-print-page" style={themeStyle(settings)}>
      <div className="giftcards-print-actions">
        <Button type="button" variant="secondary" onClick={() => window.location.assign('/')}>Back</Button>
        <Button type="button" onClick={() => window.print()} disabled={!card}>Print / save PDF</Button>
      </div>
      {message ? <p className="error-text">{message}</p> : null}
      {card ? (
        <section className="giftcards-print-card">
          <div className="giftcards-print-brand">ALMA Gift Cards</div>
          {settings.artworkUrl ? <img className="giftcards-print-artwork" src={settings.artworkUrl} alt="" /> : null}
          <h1>{formatCents(card.balanceCents)}</h1>
          <p>Redeemable at ALMA venues</p>
          <div className="giftcards-print-code">{card.code}</div>
          <img className="giftcards-print-qr" src={card.qrCodeUrl} alt="Gift card redemption QR code" />
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
  const sectionFromLocation = useCallback(() => {
    if (window.location.pathname.startsWith('/orders')) return '/orders#recent';
    if (window.location.pathname.startsWith('/admin')) return '/admin#settings';
    return '/redeem#redeem';
  }, []);
  const [activeHref, setActiveHref] = useState(sectionFromLocation);

  useEffect(() => {
    const syncHash = () => setActiveHref(sectionFromLocation());
    syncHash();
    window.addEventListener('hashchange', syncHash);
    window.addEventListener('popstate', syncHash);
    return () => {
      window.removeEventListener('hashchange', syncHash);
      window.removeEventListener('popstate', syncHash);
    };
  }, [sectionFromLocation]);

  const active = GIFTCARD_NAV_ITEMS.find((item) => item.href === activeHref) ?? GIFTCARD_NAV_ITEMS[2]!;

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
              className={activeHref === item.href ? 'active' : ''}
              onClick={() => {
                setActiveHref(item.href);
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

function GiftCardAdminSettings({ user }: { user: AuthUser }) {
  type PromoDraft = {
    code: string;
    description: string;
    discountType: 'PERCENT' | 'FIXED_AMOUNT';
    percentOff: number;
    expiresAt: string;
    maxRedemptions: string;
  };

  const [settings, setSettings] = useState<GiftCardSettings>(DEFAULT_GIFT_CARD_SETTINGS);
  const [canManagePromoCodes, setCanManagePromoCodes] = useState(false);
  const [promoCodes, setPromoCodes] = useState<GiftCardPromoCode[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [promoAmount, setPromoAmount] = useState('10');
  const [promoDraft, setPromoDraft] = useState<PromoDraft>({
    code: '',
    description: '',
    discountType: 'PERCENT' as const,
    percentOff: 10,
    expiresAt: '',
    maxRedemptions: ''
  });

  const canEdit = canManagePromoCodes && user.email?.toLowerCase() === 'tim@almagroup.com.au';

  const load = useCallback(async () => {
    try {
      const [settingsResponse, promos] = await Promise.all([
        api<GiftCardAdminSettingsResponse>('/api/gift-cards/settings'),
        api<GiftCardPromoCode[]>('/api/gift-cards/promo-codes')
      ]);
      setSettings(settingsResponse.settings);
      setCanManagePromoCodes(settingsResponse.canManagePromoCodes);
      setPromoCodes(promos);
    } catch (error) {
      setMessageTarget(null);
      setMessage(error instanceof Error ? error.message : 'Could not load gift card settings.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setMessageTarget('settings');
    try {
      setSettings(await api<GiftCardSettings>('/api/gift-cards/settings', {
        method: 'PATCH',
        body: JSON.stringify(settings)
      }));
      setMessage('Gift card settings saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save gift card settings.');
    } finally {
      setSaving(false);
    }
  }

  async function updateImage(field: 'heroImageUrl' | 'artworkUrl', file: File | undefined) {
    if (!file) return;
    setMessage(null);
    setMessageTarget('settings');
    try {
      const dataUrl = await imageToDataUrl(file);
      setSettings((current) => ({ ...current, [field]: dataUrl }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not upload artwork.');
    }
  }

  async function createPromoCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setMessageTarget('promo');
    try {
      const body = {
        code: promoDraft.code,
        description: promoDraft.description,
        discountType: promoDraft.discountType,
        percentOff: promoDraft.discountType === 'PERCENT' ? promoDraft.percentOff : undefined,
        amountOffCents: promoDraft.discountType === 'FIXED_AMOUNT' ? Math.round(Number(promoAmount) * 100) : undefined,
        expiresAt: promoDraft.expiresAt,
        maxRedemptions: promoDraft.maxRedemptions ? Number(promoDraft.maxRedemptions) : undefined,
        isActive: true
      };
      await api<GiftCardPromoCode>('/api/gift-cards/promo-codes', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      setPromoDraft({ code: '', description: '', discountType: 'PERCENT', percentOff: 10, expiresAt: '', maxRedemptions: '' });
      setPromoAmount('10');
      setMessage('Promo code created.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create promo code.');
    } finally {
      setSaving(false);
    }
  }

  async function removePromoCode(promo: GiftCardPromoCode) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`promo:${promo.id}`);
    try {
      await api<GiftCardPromoCode>(`/api/gift-cards/promo-codes/${encodeURIComponent(promo.id)}`, { method: 'DELETE' });
      setMessage(`${promo.code} removed.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove promo code.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="giftcards-settings-grid">
      <Card title="Gift card admin setup" subtitle="Operational redemption stays in Redeem and Orders. Product, payment, artwork and promo controls are grouped here until the dedicated Admin app owns this section.">
        <p className="subtle">
          Live payment capture is still server controlled. This screen does not expose provider secrets, and checkout remains setup-required unless the backend reports a safe mode.
        </p>
      </Card>

      <Card title="Checkout and email" subtitle="Controls the public gift card page, printable card, email artwork, and test checkout.">
        <form className="giftcards-form" onSubmit={(event) => void saveSettings(event)}>
          {!canEdit ? <p className="subtle">Only Tim can change gift card checkout settings.</p> : null}
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.testCheckoutEnabled}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setSettings((current) => ({ ...current, testCheckoutEnabled: checked }));
              }}
              disabled={!canEdit}
            />
            <span>Test checkout mode. Stripe is disabled and cards are created as test cards.</span>
          </label>
          <div className="form-grid two">
            <Input label="Public headline" value={settings.publicHeadline} onChange={(event) => setSettings((current) => ({ ...current, publicHeadline: event.currentTarget.value }))} disabled={!canEdit} />
            <Input label="Email subject" value={settings.emailSubject} onChange={(event) => setSettings((current) => ({ ...current, emailSubject: event.currentTarget.value }))} disabled={!canEdit} />
          </div>
          <Textarea label="Public subheading" rows={2} value={settings.publicSubheading} onChange={(event) => setSettings((current) => ({ ...current, publicSubheading: event.currentTarget.value }))} disabled={!canEdit} />
          <Textarea label="Email intro" rows={2} value={settings.emailIntro} onChange={(event) => setSettings((current) => ({ ...current, emailIntro: event.currentTarget.value }))} disabled={!canEdit} />
          <div className="form-grid two">
            <Input label="Primary colour" type="color" value={settings.primaryColor} onChange={(event) => setSettings((current) => ({ ...current, primaryColor: event.currentTarget.value }))} disabled={!canEdit} />
            <Input label="Accent colour" type="color" value={settings.accentColor} onChange={(event) => setSettings((current) => ({ ...current, accentColor: event.currentTarget.value }))} disabled={!canEdit} />
          </div>
          <div className="giftcards-artwork-grid">
            <label>
              <span>Public hero image</span>
              <input type="file" accept="image/*" onChange={(event) => void updateImage('heroImageUrl', event.currentTarget.files?.[0])} disabled={!canEdit} />
              {settings.heroImageUrl ? <img src={settings.heroImageUrl} alt="" /> : null}
            </label>
            <label>
              <span>Email / printable artwork</span>
              <input type="file" accept="image/*" onChange={(event) => void updateImage('artworkUrl', event.currentTarget.files?.[0])} disabled={!canEdit} />
              {settings.artworkUrl ? <img src={settings.artworkUrl} alt="" /> : null}
            </label>
          </div>
          <div className="toolbar-right">
            <ActionFeedback
              message={messageTarget === 'settings' ? message : null}
              tone={message?.includes('Could') ? 'error' : 'success'}
            />
            <Button type="submit" disabled={saving || !canEdit}>{saving ? 'Saving...' : 'Save gift card settings'}</Button>
          </div>
        </form>
      </Card>

      <Card title="Promo codes" subtitle="Only Tim can add or remove promo codes. Managers can see what is active.">
        {message && !messageTarget ? <p className={message.includes('Could') || message.includes('Only') ? 'error-text' : 'subtle'}>{message}</p> : null}
        <form className="giftcards-form" onSubmit={(event) => void createPromoCode(event)}>
          <div className="form-grid two">
            <Input label="Code" required value={promoDraft.code} onChange={(event) => setPromoDraft((current) => ({ ...current, code: event.currentTarget.value.toUpperCase() }))} placeholder="ALMA10" disabled={!canEdit} />
            <Input label="Description" value={promoDraft.description} onChange={(event) => setPromoDraft((current) => ({ ...current, description: event.currentTarget.value }))} placeholder="Opening week offer" disabled={!canEdit} />
          </div>
          <div className="form-grid two">
            <Select
              label="Discount"
              value={promoDraft.discountType}
              onChange={(event) => setPromoDraft((current) => ({ ...current, discountType: event.currentTarget.value as 'PERCENT' | 'FIXED_AMOUNT' }))}
              options={[
                { label: 'Percent off', value: 'PERCENT' },
                { label: 'Fixed amount off', value: 'FIXED_AMOUNT' }
              ]}
              disabled={!canEdit}
            />
            {promoDraft.discountType === 'PERCENT' ? (
              <Input label="Percent off" type="number" min="1" max="95" value={promoDraft.percentOff} onChange={(event) => setPromoDraft((current) => ({ ...current, percentOff: Number(event.currentTarget.value) }))} disabled={!canEdit} />
            ) : (
              <Input label="Amount off" type="number" min="1" step="1" value={promoAmount} onChange={(event) => setPromoAmount(event.currentTarget.value)} disabled={!canEdit} />
            )}
          </div>
          <div className="form-grid two">
            <Input label="Expiry" type="date" value={promoDraft.expiresAt} onChange={(event) => setPromoDraft((current) => ({ ...current, expiresAt: event.currentTarget.value }))} disabled={!canEdit} />
            <Input label="Max redemptions" type="number" min="1" value={promoDraft.maxRedemptions} onChange={(event) => setPromoDraft((current) => ({ ...current, maxRedemptions: event.currentTarget.value }))} disabled={!canEdit} />
          </div>
          <div className="toolbar-right">
            <ActionFeedback
              message={messageTarget === 'promo' ? message : null}
              tone={message?.includes('Could') ? 'error' : 'success'}
            />
            <Button type="submit" disabled={saving || !canEdit}>{saving ? 'Saving...' : 'Add promo code'}</Button>
          </div>
        </form>
        <div className="giftcards-promo-list">
          {promoCodes.map((promo) => (
            <div key={promo.id}>
              <span>
                <strong>{promo.code}</strong>
                <small>
                  {promo.discountType === 'PERCENT' ? `${promo.percentOff}% off` : `${formatCents(promo.amountOffCents ?? 0)} off`}
                  {promo.expiresAt ? ` · expires ${new Date(promo.expiresAt).toLocaleDateString('en-AU')}` : ''}
                  {promo.maxRedemptions ? ` · ${promo.confirmedRedemptions}/${promo.maxRedemptions} used` : ` · ${promo.confirmedRedemptions} used`}
                </small>
              </span>
              <span>
                <Badge tone={promo.isActive ? 'positive' : 'neutral'}>{promo.isActive ? 'ACTIVE' : 'REMOVED'}</Badge>
                <Button type="button" variant="secondary" disabled={saving || !canEdit || !promo.isActive} onClick={() => void removePromoCode(promo)}>Remove</Button>
                <ActionFeedback
                  message={messageTarget === `promo:${promo.id}` ? message : null}
                  tone={message?.includes('Could') ? 'error' : 'success'}
                />
              </span>
            </div>
          ))}
          {promoCodes.length === 0 ? <EmptyState title="No promo codes yet" description="Create the first code when you are ready." /> : null}
        </div>
      </Card>
    </div>
  );
}

function GiftCardDashboard({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const [data, setData] = useState<GiftCardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [venue, setVenue] = useState(VENUES[0]);
  const [notes, setNotes] = useState('');
  const [selectedCard, setSelectedCard] = useState<GiftCard | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
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
      setMessageTarget(null);
      setMessage(error instanceof Error ? error.message : 'Could not load gift cards.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const scannedCode = params.get('code');
    if (!scannedCode) return;
    setCode(scannedCode.toUpperCase());
    window.location.hash = '#redeem';
  }, []);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setMessageTarget('lookup');
    try {
      setSelectedCard(await api<GiftCard>(`/api/gift-cards/cards/${encodeURIComponent(code.trim())}`));
      setMessage('Balance loaded.');
    } catch (error) {
      setSelectedCard(null);
      setMessage(error instanceof Error ? error.message : 'Gift card not found.');
    }
  }

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setMessageTarget('redeem');
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
      await load();
      setMessageTarget('redeem');
      setMessage(`Redeemed ${formatCents(updated.initialValueCents - updated.balanceCents)} total. Remaining balance ${formatCents(updated.balanceCents)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not redeem gift card.');
    }
  }

  async function cancelCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!card) return;
    setMessage(null);
    setMessageTarget('cancel');
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
      await load();
      setMessageTarget('cancel');
      setMessage('Gift card cancelled. Stripe refund, if needed, still needs to be handled in Stripe.');
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
              <SuiteCommsWidget
                appId="GIFTCARDS"
                api={api}
                venue={user.venue}
                userName={`${user.firstName} ${user.lastName}`}
                canAnnounce={user.role !== 'STAFF'}
              />
              <Button type="button" variant="secondary" onClick={() => void onLogout()}>Sign out</Button>
            </>
          }
        />
      }
    >
      <div className="giftcards-page">
        <PageHeader
          eyebrow="ALMA Gift Cards"
          title="Gift card operations"
          description="Daily register work stays here: check balances, redeem customer cards, and review recent orders. Checkout, artwork, promo codes, and payment setup are grouped under Admin setup."
          actions={<Input label="Search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Code, name, email" />}
        />
        {message && !messageTarget ? <p className={message.includes('Could') || message.includes('not') || message.includes('low') ? 'error-text' : 'subtle'}>{message}</p> : null}
        <div className="stats-grid">
          <StatCard label="Active" value={data?.totals.active ?? 0} hint="Can be redeemed" loading={loading} />
          <StatCard label="Redeemed" value={data?.totals.redeemed ?? 0} hint="Fully used" loading={loading} />
          <StatCard label="Balance" value={formatCents(data?.totals.activeBalanceCents ?? 0)} hint="Outstanding liability" loading={loading} />
          <StatCard label="Sold" value={formatCents(data?.totals.soldValueCents ?? 0)} hint={`${data?.totals.test ?? 0} test cards excluded`} loading={loading} />
        </div>
        <div className="giftcards-layout">
          <div id="redeem">
          <Card title="Redeem gift card" subtitle="Enter the customer code and redeem only the amount used.">
            <form className="giftcards-form" onSubmit={(event) => void lookup(event)}>
              <Input label="Gift card code" required value={code} onChange={(event) => setCode(event.currentTarget.value.toUpperCase())} placeholder="ALMA-XXXXXXXX" />
              <div className="toolbar-right">
                <ActionFeedback
                  message={messageTarget === 'lookup' ? message : null}
                  tone={message?.includes('not') || message?.includes('Could') ? 'error' : 'success'}
                />
                <Button type="submit" variant="secondary">Check balance</Button>
              </div>
            </form>
            {card ? (
              <form className="giftcards-form" onSubmit={(event) => void redeem(event)}>
                <div className="giftcards-balance-card">
                  <strong>{card.code}</strong>
                  <span>{formatCents(card.balanceCents)} remaining of {formatCents(card.initialValueCents)}</span>
                  <Badge tone={statusTone(card.status)}>{card.status.replace('_', ' ')}</Badge>
                  {card.testMode ? <Badge tone="warning">TEST MODE</Badge> : null}
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
                  <ActionFeedback
                    message={messageTarget === 'redeem' ? message : null}
                    tone={message?.includes('Could') || message?.includes('low') ? 'error' : 'success'}
                  />
                  <Button type="submit" disabled={!card || card.status !== 'ACTIVE'}>Redeem</Button>
                  <Button type="button" variant="secondary" onClick={() => window.open(giftCardPrintUrl(card.code), '_blank')}>Print</Button>
                </div>
              </form>
            ) : null}
            {card && card.status !== 'CANCELLED' && card.status !== 'EXPIRED' ? (
              <form className="giftcards-form giftcards-cancel-form" onSubmit={(event) => void cancelCard(event)}>
                <Textarea label="Void / cancellation reason" required rows={2} value={cancelReason} onChange={(event) => setCancelReason(event.currentTarget.value)} />
                <Textarea label="Refund note" rows={2} value={refundNote} onChange={(event) => setRefundNote(event.currentTarget.value)} placeholder="Example: refunded in Stripe dashboard, left as store credit, manager comp" />
                <div className="toolbar-right">
                  <ActionFeedback
                    message={messageTarget === 'cancel' ? message : null}
                    tone={message?.includes('Could') ? 'error' : 'success'}
                  />
                  <Button type="submit" variant="danger">Cancel card</Button>
                </div>
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
                    <small>{item.recipientName || item.purchaserName} · {item.purchaserEmail}{item.promoCodeSnapshot ? ` · ${item.promoCodeSnapshot}` : ''}{item.testMode ? ' · TEST' : ''}</small>
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
        <div id="settings">
          <GiftCardAdminSettings user={user} />
        </div>
      </div>
    </AppShell>
  );
}

function GiftCardAdminApp() {
  const auth = useGiftCardAuth();

  if (auth.loading) return <div className="login-page"><Spinner label="Checking session" /></div>;
  if (!auth.user) return <LoginScreen onLogin={auth.login} />;
  return <GiftCardDashboard user={auth.user} onLogout={auth.logout} />;
}

export function App() {
  const isRedeemPath = window.location.pathname.startsWith('/redeem');
  const isOrdersPath = window.location.pathname.startsWith('/orders');
  const isAdminPath = window.location.pathname.startsWith('/admin');
  const isPrintPath = window.location.pathname.startsWith('/print');

  if (isPrintPath) return <PrintableGiftCardPage />;
  if (!isRedeemPath && !isOrdersPath && !isAdminPath) return <PublicGiftCardShop />;
  return <GiftCardAdminApp />;
}
