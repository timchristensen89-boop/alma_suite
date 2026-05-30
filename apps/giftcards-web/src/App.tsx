import { type CSSProperties, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadStripe, type Stripe, type StripeEmbeddedCheckout } from '@stripe/stripe-js';
import {
  DEFAULT_GIFT_CARD_SETTINGS,
  GIFT_CARD_DESIGNS,
  type AuthUser,
  type GiftCard,
  type GiftCardAdminSettingsResponse,
  type GiftCardCheckoutResult,
  type GiftCardDesign,
  type GiftCardOverview,
  type GiftCardPromoCode,
  type GiftCardPromoQuote,
  type GiftCardPublicConfig,
  type GiftCardPublic,
  type GiftCardSettings
} from '@alma/shared';
import { GIFT_CARD_DESIGN_META, GiftCardArt, isGiftCardDesign } from './giftCardArt';
import {
  AppShell,
  ActionFeedback,
  ActionPanel,
  Badge,
  AlmaHomeBubble,
  Button,
  Card,
  ChartIcon,
  DocumentIcon,
  EditorialAppHeader,
  EmptyState,
  Input,
  ProductLogo,
  SearchIcon,
  Select,
  Spinner,
  StatCard,
  SUITE_APPS,
  SuiteAppSwitcher,
  SuiteCommsWidget,
  SuiteFeedbackWidget,
  SuiteNotificationsWidget,
  Textarea,
  TopBar,
  useDismissibleLayer
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
    href: '/activate#activate',
    label: 'Activate physical',
    description: 'Sell a pre-printed card at the counter',
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

function WalletButtons({ card, wallet, onMessage }: { card: GiftCardPublic; wallet?: WalletConfig | null; onMessage?: (message: string | null) => void }) {
  const canAddToWallet = card.status === 'ACTIVE' && card.balanceCents > 0;

  if (!canAddToWallet) return null;
  const appleReady = wallet?.appleConfigured ?? true;
  const googleReady = wallet?.googleConfigured ?? true;

  return (
    <div className="giftcards-wallet-actions" aria-label="Add gift card to wallet">
      <button
        type="button"
        className="giftcards-wallet-button giftcards-wallet-button-apple"
        disabled={!appleReady}
        onClick={() => {
          if (!appleReady) {
            onMessage?.('Apple Wallet is not configured yet.');
            return;
          }
          onMessage?.(null);
          window.location.assign(giftCardAppleWalletUrl(card.code));
        }}
      >
        Add to Apple Wallet
      </button>
      <button
        type="button"
        className="giftcards-wallet-button giftcards-wallet-button-google"
        disabled={!googleReady}
        onClick={() => {
          if (!googleReady) {
            onMessage?.('Google Wallet is not configured yet.');
            return;
          }
          onMessage?.(null);
          window.location.assign(giftCardGoogleWalletUrl(card.code));
        }}
      >
        Add to Google Wallet
      </button>
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

// Six gift card designs are sourced from the Alma design bundle
// (project/gift-card-art.jsx). Catalogue + React renderers live in
// ./giftCardArt. Picker swatches use design.swatchBg.

const QUICK_MESSAGES = [
  { short: 'Have the best night…', long: "Have the best night. Order the scallops. Don't drive." },
  { short: 'Happy birthday.', long: 'Happy birthday. Order the second margarita. Love you.' },
  { short: 'Thank you.', long: "Thank you — for everything this year. Dinner's on me." },
  { short: 'Congratulations.', long: 'Congratulations. Go celebrate properly. So proud of you.' },
  { short: 'Just because.', long: "Just because. Enjoy the long lunch you've been promising yourself." }
];

const AMOUNT_PILLS: Array<{ amountCents: number; label: string }> = [
  { amountCents: 5000, label: 'A round' },
  { amountCents: 10000, label: 'Dinner for one' },
  { amountCents: 12000, label: 'Most popular' },
  { amountCents: 25000, label: 'Long dinner' }
];

type CheckoutOverlayState = 'closed' | 'loading' | 'checkout' | 'processing' | 'complete';

type EmbeddedCheckoutRequest = {
  publishableKey: string;
  clientSecret: string;
  sessionId: string;
};

type WalletConfig = GiftCardPublicConfig['wallet'];

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function PublicGiftCardShop() {
  const [settings, setSettings] = useState<GiftCardSettings>(DEFAULT_GIFT_CARD_SETTINGS);
  const [checkoutMode, setCheckoutMode] = useState<'live' | 'test' | 'setup_required'>('setup_required');
  const [checkoutNotice, setCheckoutNotice] = useState<string | null>(null);
  const [walletConfig, setWalletConfig] = useState<WalletConfig | null>(null);
  const [amountCents, setAmountCents] = useState(12000);
  const [customAmount, setCustomAmount] = useState('');
  const [design, setDesign] = useState<GiftCardDesign>('forest');
  // Scheduled delivery — when deliverMode='later', deliverDate (YYYY-MM-DD)
  // is resolved to 07:00 venue-local and posted as scheduledDeliveryAt.
  // Server defers the email until the /jobs/gift-cards/drain scheduler
  // reaches it.
  const [deliverMode, setDeliverMode] = useState<'now' | 'later'>('now');
  const [deliverDate, setDeliverDate] = useState('');
  const [previewSide, setPreviewSide] = useState<'front' | 'back'>('front');
  const [promoCode, setPromoCode] = useState('');
  const [promoQuote, setPromoQuote] = useState<GiftCardPromoQuote | null>(null);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [applyingPromo, setApplyingPromo] = useState(false);
  const [purchaserName, setPurchaserName] = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [recipientName, setRecipientName] = useState('Caro');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [message, setMessage] = useState("Have the best night. Order the scallops. Don't drive.");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [navSolid, setNavSolid] = useState(false);
  const sessionId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('session_id') : null;
  const [paidCard, setPaidCard] = useState<GiftCardPublic | null>(null);
  const [checkoutOverlay, setCheckoutOverlay] = useState<CheckoutOverlayState>('closed');
  const [checkoutOverlayMessage, setCheckoutOverlayMessage] = useState<string | null>(null);
  const [embeddedCheckoutRequest, setEmbeddedCheckoutRequest] = useState<EmbeddedCheckoutRequest | null>(null);
  const stripePromiseRef = useRef<{ key: string; promise: Promise<Stripe | null> } | null>(null);
  const embeddedCheckoutRef = useRef<StripeEmbeddedCheckout | null>(null);
  const embeddedCheckoutHostRef = useRef<HTMLDivElement | null>(null);

  const amountDueCents = promoQuote ? promoQuote.amountDueCents : amountCents;
  const amountError = amountCents < 2500 || amountCents > 200000
    ? 'Choose an amount between $25 and $2,000.'
    : null;
  const checkoutBlocked = checkoutMode === 'setup_required';
  const amountWhole = Math.round(amountCents / 100);

  useEffect(() => {
    api<GiftCardPublicConfig>('/api/gift-cards/public/config')
      .then((config) => {
        setSettings(config.settings);
        setCheckoutMode(config.checkoutMode);
        setCheckoutNotice(config.checkoutNotice);
        setWalletConfig(config.wallet);
      })
      .catch(() => undefined);
  }, []);

  const destroyEmbeddedCheckout = useCallback(() => {
    embeddedCheckoutRef.current?.destroy();
    embeddedCheckoutRef.current = null;
  }, []);

  const finaliseCheckoutSession = useCallback(async (checkoutSessionId: string) => {
    destroyEmbeddedCheckout();
    setCheckoutOverlay('processing');
    setCheckoutOverlayMessage('Confirming payment and preparing the gift card email.');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const card = await api<GiftCardPublic>(`/api/gift-cards/session/${encodeURIComponent(checkoutSessionId)}`);
        setPaidCard(card);
        setCheckoutOverlay('complete');
        setCheckoutOverlayMessage(card.emailError ? 'Payment is confirmed. The email needs manual attention.' : 'Payment is confirmed and the confirmation email has been queued.');
        if (window.location.search.includes('session_id=')) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        return;
      } catch (error) {
        if (attempt === 7) {
          const message = error instanceof Error ? error.message : 'Could not confirm gift card payment.';
          setFeedback(message);
          setCheckoutOverlayMessage(message);
          return;
        }
        await wait(1500);
      }
    }
  }, [destroyEmbeddedCheckout]);

  useEffect(() => {
    if (!sessionId) return;
    void finaliseCheckoutSession(sessionId);
  }, [sessionId, finaliseCheckoutSession]);

  useEffect(() => {
    const onScroll = () => setNavSolid(window.scrollY > 80);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (checkoutOverlay !== 'checkout' || !embeddedCheckoutRequest || !embeddedCheckoutHostRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        destroyEmbeddedCheckout();
        if (!stripePromiseRef.current || stripePromiseRef.current.key !== embeddedCheckoutRequest.publishableKey) {
          stripePromiseRef.current = {
            key: embeddedCheckoutRequest.publishableKey,
            promise: loadStripe(embeddedCheckoutRequest.publishableKey)
          };
        }
        const stripe = await stripePromiseRef.current.promise;
        if (!stripe) throw new Error('Stripe checkout could not load.');
        const embeddedCheckout = await stripe.createEmbeddedCheckoutPage({
          clientSecret: embeddedCheckoutRequest.clientSecret,
          onComplete: () => void finaliseCheckoutSession(embeddedCheckoutRequest.sessionId)
        });
        if (cancelled) {
          embeddedCheckout.destroy();
          return;
        }
        embeddedCheckoutRef.current = embeddedCheckout;
        embeddedCheckout.mount(embeddedCheckoutHostRef.current!);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not load secure checkout.';
        setFeedback(message);
        setCheckoutOverlayMessage(message);
        setCheckoutOverlay('closed');
      }
    })();

    return () => {
      cancelled = true;
      destroyEmbeddedCheckout();
    };
  }, [checkoutOverlay, embeddedCheckoutRequest, destroyEmbeddedCheckout, finaliseCheckoutSession]);

  useEffect(() => () => destroyEmbeddedCheckout(), [destroyEmbeddedCheckout]);

  function closeCheckoutOverlay() {
    destroyEmbeddedCheckout();
    setEmbeddedCheckoutRequest(null);
    setCheckoutOverlay('closed');
    setCheckoutOverlayMessage(null);
  }

  async function checkout(event?: FormEvent) {
    event?.preventDefault();
    if (checkoutBlocked) {
      setFeedback(checkoutNotice ?? 'Payment setup is required before gift card checkout can go live.');
      return;
    }
    if (amountError) {
      setFeedback(amountError);
      return;
    }
    if (!purchaserName.trim() || !purchaserEmail.trim()) {
      setFeedback('Add your name and email so we can send the receipt.');
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    setCheckoutOverlay('loading');
    setCheckoutOverlayMessage('Setting up secure checkout.');
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
          design,
          checkoutUiMode: 'embedded',
          scheduledDeliveryAt: deliverMode === 'later' && deliverDate
            ? new Date(`${deliverDate}T07:00`).toISOString()
            : undefined,
          successUrl: `${window.location.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: window.location.origin
        })
      });
      if (result.testMode) {
        await finaliseCheckoutSession(result.checkoutSessionId);
        return;
      }
      if (result.embedded && result.checkoutClientSecret && result.stripePublishableKey) {
        setEmbeddedCheckoutRequest({
          publishableKey: result.stripePublishableKey,
          clientSecret: result.checkoutClientSecret,
          sessionId: result.checkoutSessionId
        });
        setCheckoutOverlay('checkout');
        setCheckoutOverlayMessage(null);
        return;
      }
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not start gift card checkout.');
      setCheckoutOverlay('closed');
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
    if (Number.isFinite(dollars) && dollars > 0) {
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

  const senderSignature = purchaserName.trim()
    ? (purchaserName.trim().toUpperCase().startsWith('FROM') ? `— ${purchaserName.trim().toUpperCase()}` : `— FROM ${purchaserName.trim().toUpperCase()}`)
    : '— FROM TOM';
  const recipientDisplay = (recipientName || '').trim() || '—';
  const deliveryLabel = deliverMode === 'now'
    ? 'By email · sent right after payment'
    : deliverDate
      ? `By email · ${new Date(`${deliverDate}T07:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}, 7am`
      : 'By email · pick a date';

  return (
    <main className="alma-giftcards-page" style={themeStyle(settings)}>
      <nav className={`alma-giftcards-nav ${navSolid ? 'is-solid' : ''}`} aria-label="Alma Group">
        <a href="https://www.almagroup.com.au/" className="alma-giftcards-nav__word" aria-label="Alma Group">
          <img src="/images/alma-group-logo.png" alt="Alma Group" />
        </a>
        <ul className="alma-giftcards-nav__links">
          <li><a href="https://www.almagroup.com.au/alma-avalon">Avalon</a></li>
          <li><a href="https://www.almagroup.com.au/st-alma">St. Alma</a></li>
          <li><a href="https://www.almagroup.com.au/menu">Menu</a></li>
          <li><a href="#configure" className="is-current">Gift cards</a></li>
          <li><a href="https://www.almagroup.com.au/events">Events</a></li>
          <li><a href="https://www.almagroup.com.au/contact">Visit</a></li>
        </ul>
        <a href="#configure" className="alma-giftcards-nav__cta">Buy a card →</a>
      </nav>

      {checkoutOverlay !== 'closed' ? (
        <div className="alma-giftcards-checkout" role="dialog" aria-modal="true" aria-labelledby="alma-giftcards-checkout-title">
          <div className="alma-giftcards-checkout__panel">
            <div className="alma-giftcards-checkout__head">
              <div>
                <span className="alma-giftcards-eyebrow">Secure payment</span>
                <h2 id="alma-giftcards-checkout-title">
                  {checkoutOverlay === 'complete'
                    ? 'Your gift card is ready.'
                    : checkoutOverlay === 'processing'
                      ? 'Processing payment.'
                      : checkoutOverlay === 'checkout'
                        ? 'Complete your checkout.'
                        : 'Opening checkout.'}
                </h2>
              </div>
              <button
                type="button"
                className="alma-giftcards-checkout__close"
                onClick={closeCheckoutOverlay}
                aria-label="Close checkout"
                disabled={checkoutOverlay === 'processing'}
              >
                ×
              </button>
            </div>

            {checkoutOverlay === 'loading' ? (
              <div className="alma-giftcards-checkout__state">
                <Spinner label="Setting up checkout..." />
                <p>{checkoutOverlayMessage ?? 'Setting up secure checkout.'}</p>
              </div>
            ) : null}

            {checkoutOverlay === 'checkout' ? (
              <>
                <p className="alma-giftcards-checkout__copy">Payment stays inside this window and is processed by Stripe.</p>
                <div className="alma-giftcards-checkout__stripe" ref={embeddedCheckoutHostRef} />
              </>
            ) : null}

            {checkoutOverlay === 'processing' ? (
              <div className="alma-giftcards-checkout__state">
                <Spinner label="Processing payment..." />
                <p>{checkoutOverlayMessage ?? 'Confirming payment and preparing your confirmation.'}</p>
              </div>
            ) : null}

            {checkoutOverlay === 'complete' && paidCard ? (
              <div className="alma-giftcards-checkout__complete">
                <div className="alma-giftcards-checkout__art">
                  <GiftCardArt
                    design={isGiftCardDesign(paidCard.design) ? paidCard.design : 'forest'}
                    amount={Math.round(paidCard.initialValueCents / 100)}
                    code={paidCard.code}
                    recipient={paidCard.recipientName ?? undefined}
                  />
                </div>
                <div className="alma-giftcards-checkout__details">
                  <div>
                    <span>Reference</span>
                    <strong>{paidCard.code}</strong>
                  </div>
                  <div>
                    <span>Balance</span>
                    <strong>{formatCents(paidCard.balanceCents)}</strong>
                  </div>
                  <img src={paidCard.qrCodeUrl} alt="Gift card redemption QR code" />
                </div>
                <p>{checkoutOverlayMessage}</p>
                <div className="alma-giftcards-paid__actions">
                  <button type="button" className="alma-giftcards-btn alma-giftcards-btn--primary" onClick={() => window.location.assign(giftCardPrintUrl(paidCard.code))}>
                    Print gift card
                  </button>
                  <WalletButtons card={paidCard} wallet={walletConfig} onMessage={setFeedback} />
                </div>
                {paidCard.emailError ? <p className="alma-giftcards-error">Email needs attention: {paidCard.emailError}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {paidCard ? (
        <section className="alma-giftcards-paid" aria-label="Gift card payment received">
          <div className="alma-giftcards-paid__inner">
            <p className="alma-giftcards-eyebrow">
              {paidCard.testMode ? 'Test checkout complete' : 'Payment received'}
            </p>
            <h2 className="alma-giftcards-paid__title">
              Your card <em>is ready.</em>
            </h2>
            <div style={{ maxWidth: 480, margin: '8px 0', position: 'relative', width: '100%', aspectRatio: '1.586 / 1' }}>
              <GiftCardArt
                design={isGiftCardDesign(paidCard.design) ? paidCard.design : 'forest'}
                amount={Math.round(paidCard.initialValueCents / 100)}
                code={paidCard.code}
                recipient={paidCard.recipientName ?? undefined}
              />
            </div>
            <div className="alma-giftcards-paid__details">
              <div>
                <span className="alma-giftcards-paid__label">Reference</span>
                <strong>{paidCard.code}</strong>
              </div>
              <div>
                <span className="alma-giftcards-paid__label">Balance</span>
                <strong>{formatCents(paidCard.balanceCents)}</strong>
              </div>
              <div className="alma-giftcards-paid__badges">
                <Badge tone={paidCard.status === 'ACTIVE' ? 'positive' : 'warning'}>{paidCard.status.replace('_', ' ')}</Badge>
                {paidCard.testMode ? <Badge tone="warning">TEST MODE</Badge> : null}
              </div>
            </div>
            <img className="alma-giftcards-paid__qr" src={paidCard.qrCodeUrl} alt="Gift card redemption QR code" />
            <div className="alma-giftcards-paid__actions">
              <button type="button" className="alma-giftcards-btn alma-giftcards-btn--ghost" onClick={() => window.location.assign(giftCardPrintUrl(paidCard.code))}>
                Print gift card
              </button>
              <WalletButtons card={paidCard} wallet={walletConfig} onMessage={setFeedback} />
            </div>
            {paidCard.emailError ? <p className="alma-giftcards-error">Email needs attention: {paidCard.emailError}</p> : null}
          </div>
        </section>
      ) : null}

      <header className="alma-giftcards-hero">
        <div className="alma-giftcards-hero__grid">
          <div className="alma-giftcards-hero__left">
            <div className="alma-giftcards-hero__eyebrow-row">
              <span className="alma-giftcards-hero__dot" aria-hidden="true" />
              <span className="alma-giftcards-eyebrow">alma gift card · Avalon &amp; St. Alma</span>
            </div>
            <h1 className="alma-giftcards-display">
              {settings.publicHeadline?.trim() || (
                <>
                  Give them dinner,
                  <em>drinks,</em>
                  <em>and a good night.</em>
                </>
              )}
            </h1>
            <p className="alma-giftcards-lede">
              {settings.publicSubheading?.trim() || 'One card. Both venues. From $25, to the cent, sent by email the moment you\'re done or scheduled for the morning of their birthday.'}
            </p>
            <div className="alma-giftcards-hero__meta">
              <div><span className="alma-giftcards-meta-label">Use it at</span><span className="alma-giftcards-meta-value">Avalon &amp; Freshwater</span></div>
              <div><span className="alma-giftcards-meta-label">Delivery</span><span className="alma-giftcards-meta-value">By email, when you choose</span></div>
              <div><span className="alma-giftcards-meta-label">Validity</span><span className="alma-giftcards-meta-value">3 years from issue</span></div>
              <div><span className="alma-giftcards-meta-label">Refunds</span><span className="alma-giftcards-meta-value">14 days, unused</span></div>
            </div>
          </div>
          <div className="alma-giftcards-hero__cardwrap">
            <div className="alma-giftcards-cardstack">
              <div className="alma-giftcards-cardstack__bg alma-giftcards-cardstack__bg--back" aria-hidden="true" />
              <div className="alma-giftcards-cardstack__bg alma-giftcards-cardstack__bg--mid" aria-hidden="true" />
              <div style={{ position: 'relative', width: '100%', aspectRatio: '1.586 / 1' }}>
                <GiftCardArt design="forest" amount={120} code="ALMA-7C92F0" />
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="alma-giftcards-quickinfo" role="list">
        <div className="alma-giftcards-quickinfo__pill" role="listitem">
          <span className="alma-giftcards-quickinfo__dot" aria-hidden="true" />
          <strong>Instant delivery</strong>
          <span>Sent within 5 minutes</span>
        </div>
        <span className="alma-giftcards-quickinfo__sep" aria-hidden="true" />
        <div className="alma-giftcards-quickinfo__pill" role="listitem">
          <strong>Or schedule</strong>
          <span>Pick the morning of</span>
        </div>
        <span className="alma-giftcards-quickinfo__sep" aria-hidden="true" />
        <div className="alma-giftcards-quickinfo__pill" role="listitem">
          <strong>Print-at-home</strong>
          <span>A4 PDF included</span>
        </div>
        <span className="alma-giftcards-quickinfo__sep" aria-hidden="true" />
        <div className="alma-giftcards-quickinfo__pill" role="listitem">
          <strong>Both venues</strong>
          <span>One reference works at either</span>
        </div>
      </div>

      {checkoutMode !== 'live' ? (
        <section className={`alma-giftcards-mode alma-giftcards-mode--${checkoutMode}`} aria-label="Checkout mode notice">
          <span className="alma-giftcards-mode__tag">{checkoutMode === 'test' ? 'Test mode' : 'Setup required'}</span>
          <span className="alma-giftcards-mode__body">
            <strong>
              {checkoutMode === 'test'
                ? "This is a test checkout. No card will be charged and no gift card is created on a real Stripe account."
                : "Online checkout is being set up. Card payments aren't live yet."}
            </strong>
            {checkoutNotice ? <span>{checkoutNotice}</span> : null}
          </span>
        </section>
      ) : null}

      <section className="alma-giftcards-configure" id="configure">
        <div className="alma-giftcards-container">
          <div className="alma-giftcards-configure__head">
            <div>
              <span className="alma-giftcards-eyebrow">Configure your card</span>
              <h2 className="alma-giftcards-h1">
                A card that <em>feels like a plan,</em>
                <br />not just a balance.
              </h2>
            </div>
            <p className="alma-giftcards-configure__meta">
              Pick an amount, a design, and write something kind. We'll do the rest — the card will arrive in their inbox looking like a real invitation.
            </p>
          </div>

          <div className="alma-giftcards-grid">
            <div className="alma-giftcards-preview" aria-live="polite">
              <div className="alma-giftcards-preview__head">
                <span className="alma-giftcards-preview__live">Live preview</span>
                <div className="alma-giftcards-preview__switch" role="tablist" aria-label="Card side">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={previewSide === 'front'}
                    className={previewSide === 'front' ? 'is-on' : ''}
                    onClick={() => setPreviewSide('front')}
                  >Front</button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={previewSide === 'back'}
                    className={previewSide === 'back' ? 'is-on' : ''}
                    onClick={() => setPreviewSide('back')}
                  >Back</button>
                </div>
              </div>

              <div style={{ position: 'relative', width: '100%', aspectRatio: '1.586 / 1' }}>
                <GiftCardArt
                  design={design}
                  amount={amountWhole}
                  recipient={recipientDisplay !== '—' ? recipientDisplay : undefined}
                  code="ALMA-7C92F0"
                  side={previewSide}
                />
              </div>

              <div className="alma-giftcards-preview__message">
                <span className="alma-giftcards-preview__quote" aria-hidden="true">&ldquo;</span>
                <p>{message || ' '}</p>
                <div className="alma-giftcards-preview__signoff">{senderSignature}</div>
              </div>

              <p className="alma-giftcards-preview__note">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                  <circle cx="7" cy="7" r="6" />
                  <line x1="7" y1="4.5" x2="7" y2="7.5" strokeLinecap="round" />
                  <circle cx="7" cy="9.5" r="0.6" fill="currentColor" />
                </svg>
                <span>This is what lands in their inbox. They can show it on their phone or print the PDF — both work at the door.</span>
              </p>
            </div>

            <form className="alma-giftcards-form" onSubmit={(event) => void checkout(event)}>
              {/* 1 — AMOUNT */}
              <div className="alma-giftcards-step">
                <div className="alma-giftcards-step__head">
                  <span className="alma-giftcards-step__num">1</span>
                  <div>
                    <h3 className="alma-giftcards-h3">Choose <em>an amount.</em></h3>
                    <div className="alma-giftcards-step__hint">$25 sets up a round of margaritas. $250 is a long dinner for two.</div>
                  </div>
                </div>
                <div className="alma-giftcards-amounts">
                  {AMOUNT_PILLS.map((entry) => (
                    <button
                      key={entry.amountCents}
                      type="button"
                      className={`alma-giftcards-amount ${amountCents === entry.amountCents && !customAmount ? 'is-on' : ''}`}
                      onClick={() => chooseAmount(entry.amountCents)}
                      aria-pressed={amountCents === entry.amountCents && !customAmount}
                    >
                      <span className="alma-giftcards-amount__value">
                        <span className="alma-giftcards-amount__currency">$</span>{Math.round(entry.amountCents / 100)}
                      </span>
                      <span className="alma-giftcards-amount__label">{entry.label}</span>
                    </button>
                  ))}
                  <div className="alma-giftcards-amount-custom">
                    <span className="alma-giftcards-amount-custom__lbl">Custom</span>
                    <span className="alma-giftcards-amount-custom__currency">$</span>
                    <input
                      type="number"
                      min="25"
                      max="2000"
                      step="5"
                      placeholder="Any amount, $25–$2,000"
                      value={customAmount}
                      onChange={(event) => updateCustomAmount(event.currentTarget.value)}
                    />
                    <span className="alma-giftcards-amount-custom__range">25 — 2,000</span>
                  </div>
                </div>
              </div>

              {/* 2 — DESIGN */}
              <div className="alma-giftcards-step">
                <div className="alma-giftcards-step__head">
                  <span className="alma-giftcards-step__num">2</span>
                  <div>
                    <h3 className="alma-giftcards-h3">Pick <em>a design.</em></h3>
                    <div className="alma-giftcards-step__hint">Six artworks from the Alma group. The chosen design ships with the email and the printable card.</div>
                  </div>
                </div>
                <div className="alma-giftcards-designs">
                  {GIFT_CARD_DESIGNS.map((d) => {
                    const meta = GIFT_CARD_DESIGN_META[d];
                    return (
                      <button
                        key={d}
                        type="button"
                        className={`alma-giftcards-design ${design === d ? 'is-on' : ''}`}
                        onClick={() => setDesign(d)}
                        aria-pressed={design === d}
                      >
                        <span className="alma-giftcards-design__swatch" style={{ background: meta.swatchBg, color: meta.swatchFg }}>
                          <span className="alma-giftcards-design__mark">alma</span>
                        </span>
                        <span className="alma-giftcards-design__name">{meta.label}</span>
                        <span className="alma-giftcards-design__who">{meta.tagline}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3 — DELIVERY */}
              <div className="alma-giftcards-step">
                <div className="alma-giftcards-step__head">
                  <span className="alma-giftcards-step__num">3</span>
                  <div>
                    <h3 className="alma-giftcards-h3">When should <em>it land?</em></h3>
                    <div className="alma-giftcards-step__hint">Right now, or on the morning of.</div>
                  </div>
                </div>
                <div className="alma-giftcards-deliver">
                  <button
                    type="button"
                    className={`alma-giftcards-toggle ${deliverMode === 'now' ? 'is-on' : ''}`}
                    onClick={() => setDeliverMode('now')}
                    aria-pressed={deliverMode === 'now'}
                  >
                    <span className="alma-giftcards-toggle__title">Send now</span>
                    <span className="alma-giftcards-toggle__sub">In their inbox within 5 minutes</span>
                  </button>
                  <button
                    type="button"
                    className={`alma-giftcards-toggle ${deliverMode === 'later' ? 'is-on' : ''}`}
                    onClick={() => setDeliverMode('later')}
                    aria-pressed={deliverMode === 'later'}
                  >
                    <span className="alma-giftcards-toggle__title">Schedule it</span>
                    <span className="alma-giftcards-toggle__sub">Pick a date — birthdays, anniversaries</span>
                  </button>
                </div>
                {deliverMode === 'later' ? (
                  <label className="alma-giftcards-field">
                    <span className="alma-giftcards-field__label">Deliver on</span>
                    <input
                      type="date"
                      value={deliverDate}
                      onChange={(event) => setDeliverDate(event.currentTarget.value)}
                    />
                    <span className="alma-giftcards-field__hint">We'll send at 7am AEST on the date you pick.</span>
                  </label>
                ) : null}
              </div>

              {/* 4 — RECIPIENT */}
              <div className="alma-giftcards-step">
                <div className="alma-giftcards-step__head">
                  <span className="alma-giftcards-step__num">4</span>
                  <div>
                    <h3 className="alma-giftcards-h3">Who's it <em>for?</em></h3>
                    <div className="alma-giftcards-step__hint">Their first name shows on the card. Their email gets it.</div>
                  </div>
                </div>
                <div className="alma-giftcards-row">
                  <label className="alma-giftcards-field">
                    <span className="alma-giftcards-field__label">Their first name</span>
                    <input
                      type="text"
                      maxLength={24}
                      placeholder="Caro"
                      value={recipientName}
                      onChange={(event) => setRecipientName(event.currentTarget.value)}
                    />
                  </label>
                  <label className="alma-giftcards-field">
                    <span className="alma-giftcards-field__label">Their email</span>
                    <input
                      type="email"
                      placeholder="caro@hotmail.com"
                      value={recipientEmail}
                      onChange={(event) => setRecipientEmail(event.currentTarget.value)}
                    />
                  </label>
                </div>
              </div>

              {/* 5 — MESSAGE */}
              <div className="alma-giftcards-step">
                <div className="alma-giftcards-step__head">
                  <span className="alma-giftcards-step__num">5</span>
                  <div>
                    <h3 className="alma-giftcards-h3">Say <em>something kind.</em></h3>
                    <div className="alma-giftcards-step__hint">Or pick a starter. You have 180 characters.</div>
                  </div>
                </div>
                <div className="alma-giftcards-quickmsg">
                  {QUICK_MESSAGES.map((entry) => (
                    <button
                      key={entry.short}
                      type="button"
                      className="alma-giftcards-quickmsg__btn"
                      onClick={() => setMessage(entry.long)}
                    >{entry.short}</button>
                  ))}
                </div>
                <label className="alma-giftcards-field">
                  <textarea
                    maxLength={180}
                    rows={3}
                    placeholder="Write a note…"
                    value={message}
                    onChange={(event) => setMessage(event.currentTarget.value)}
                  />
                  <span className="alma-giftcards-charcount">{message.length} / 180</span>
                </label>
                <label className="alma-giftcards-field">
                  <span className="alma-giftcards-field__label">Signed</span>
                  <input
                    type="text"
                    maxLength={32}
                    placeholder="From Tom"
                    value={purchaserName}
                    onChange={(event) => setPurchaserName(event.currentTarget.value)}
                  />
                </label>
              </div>

              {/* 6 — RECEIPT EMAIL (kept compact, design didn't show this but backend needs it) */}
              <div className="alma-giftcards-step">
                <div className="alma-giftcards-step__head">
                  <span className="alma-giftcards-step__num">6</span>
                  <div>
                    <h3 className="alma-giftcards-h3">Where do <em>we send</em> the receipt?</h3>
                    <div className="alma-giftcards-step__hint">Just your email, for Stripe and our records.</div>
                  </div>
                </div>
                <label className="alma-giftcards-field">
                  <span className="alma-giftcards-field__label">Your email</span>
                  <input
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={purchaserEmail}
                    onChange={(event) => setPurchaserEmail(event.currentTarget.value)}
                  />
                </label>
                <label className="alma-giftcards-field">
                  <span className="alma-giftcards-field__label">Promo code</span>
                  <div className="alma-giftcards-promo">
                    <input
                      type="text"
                      placeholder="ALMA10"
                      value={promoCode}
                      onChange={(event) => { setPromoCode(event.currentTarget.value.toUpperCase()); setPromoQuote(null); setPromoMessage(null); }}
                    />
                    <button
                      type="button"
                      className="alma-giftcards-btn alma-giftcards-btn--ghost-sm"
                      onClick={() => void applyPromoCode()}
                      disabled={applyingPromo || Boolean(amountError)}
                    >
                      {applyingPromo ? 'Checking…' : 'Apply'}
                    </button>
                  </div>
                  {promoMessage ? (
                    <span className={promoQuote ? 'alma-giftcards-field__hint' : 'alma-giftcards-error'}>{promoMessage}</span>
                  ) : null}
                </label>
              </div>

              {/* SUMMARY */}
              <div className="alma-giftcards-summary" aria-label="Order summary">
                <div className="alma-giftcards-summary__line">
                  <span>Gift card</span>
                  <strong>{GIFT_CARD_DESIGN_META[design].label} · for {recipientDisplay}</strong>
                </div>
                <div className="alma-giftcards-summary__line">
                  <span>Delivery</span>
                  <strong>{deliveryLabel}</strong>
                </div>
                <div className="alma-giftcards-summary__line">
                  <span>Card value</span>
                  <strong>{formatCents(amountCents)}</strong>
                </div>
                {promoQuote ? (
                  <div className="alma-giftcards-summary__line">
                    <span>{promoQuote.code}</span>
                    <strong>-{formatCents(promoQuote.discountCents)}</strong>
                  </div>
                ) : (
                  <div className="alma-giftcards-summary__line">
                    <span>Processing</span>
                    <strong>Free</strong>
                  </div>
                )}
                <div className="alma-giftcards-summary__total">
                  <span className="alma-giftcards-summary__total-label">You pay today</span>
                  <span className="alma-giftcards-summary__total-amt">
                    <span className="alma-giftcards-summary__total-currency">$</span>{Math.round(amountDueCents / 100)}
                  </span>
                </div>
                {feedback || amountError ? <p className="alma-giftcards-error">{feedback ?? amountError}</p> : null}
                <div className="alma-giftcards-summary__actions">
                  <button
                    type="submit"
                    className="alma-giftcards-btn alma-giftcards-btn--primary"
                    disabled={submitting || Boolean(amountError) || checkoutBlocked}
                  >
                    {checkoutBlocked
                      ? 'Payment setup required'
                      : submitting
                        ? (checkoutMode === 'test' ? 'Creating test card…' : 'Opening checkout…')
                        : checkoutMode === 'test'
                          ? `Create test card (${formatCents(amountDueCents)})`
                          : 'Open secure checkout'}
                    <svg className="alma-giftcards-arrow" viewBox="0 0 14 6" fill="none" aria-hidden="true">
                      <path d="M0 3 H13 M10 0 L13 3 L10 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
                <div className="alma-giftcards-summary__pay">
                  <div className="alma-giftcards-summary__stamps">
                    <span>Visa</span><span>MC</span><span>Amex</span><span>Apple Pay</span>
                  </div>
                  <span>Secure checkout · Stripe</span>
                </div>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section className="alma-giftcards-how" aria-label="How it works">
        <div className="alma-giftcards-container">
          <div className="alma-giftcards-how__head">
            <span className="alma-giftcards-eyebrow">How it works</span>
            <h2 className="alma-giftcards-h1">Three steps. <em>No fuss,</em> no plastic.</h2>
          </div>
          <div className="alma-giftcards-how__grid">
            <article>
              <div className="alma-giftcards-how__num">01</div>
              <h4>You write the card.</h4>
              <p>Pick an amount, a design, and write a short note. Total time from start to "sent" is about ninety seconds, even if you take your time choosing the colour.</p>
            </article>
            <article>
              <div className="alma-giftcards-how__num">02</div>
              <h4>It arrives in their inbox.</h4>
              <p>A clean email, the card image you picked, your message in the script font, and a PDF they can print or save. No login required. No app to download.</p>
            </article>
            <article>
              <div className="alma-giftcards-how__num">03</div>
              <h4>They redeem it at the table.</h4>
              <p>They show the card on their phone — or print the PDF and bring it in. We scan the reference at the till. Any unspent balance stays on the card for next time.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="alma-giftcards-venues" aria-label="Where it works">
        <div className="alma-giftcards-container">
          <div className="alma-giftcards-venues__head">
            <span className="alma-giftcards-eyebrow">Where it works</span>
            <h2 className="alma-giftcards-h1">Both venues, <em>one card.</em></h2>
          </div>
          <div className="alma-giftcards-venues__grid">
            <a className="alma-giftcards-venue" href="https://www.almagroup.com.au/alma-avalon">
              <img src="/images/alma-avalon-margaritas.jpg" alt="alma Avalon" />
              <div className="alma-giftcards-venue__overlay">
                <span className="alma-giftcards-eyebrow alma-giftcards-eyebrow--light">Avalon Beach · Restaurant &amp; Bar</span>
                <div>
                  <h3>alma Avalon</h3>
                  <div className="alma-giftcards-venue__meta">
                    <span>Open Tue–Sun · from 5:30pm</span>
                    <svg width="20" height="8" viewBox="0 0 20 8" fill="none" aria-hidden="true">
                      <path d="M0 4 H18 M14 0 L18 4 L14 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              </div>
            </a>
            <a className="alma-giftcards-venue" href="https://www.almagroup.com.au/st-alma">
              <img src="/images/st-alma-food.JPG" alt="St. Alma" />
              <div className="alma-giftcards-venue__overlay">
                <span className="alma-giftcards-eyebrow alma-giftcards-eyebrow--light">Freshwater · Counter restaurant</span>
                <div>
                  <h3>st. alma</h3>
                  <div className="alma-giftcards-venue__meta">
                    <span>Open Wed–Sun · from 5pm</span>
                    <svg width="20" height="8" viewBox="0 0 20 8" fill="none" aria-hidden="true">
                      <path d="M0 4 H18 M14 0 L18 4 L14 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>
              </div>
            </a>
          </div>
        </div>
      </section>

      <section className="alma-giftcards-faq" aria-label="Frequently asked questions">
        <div className="alma-giftcards-container alma-giftcards-faq__container">
          <div className="alma-giftcards-faq__head">
            <span className="alma-giftcards-eyebrow">Questions, lightly answered</span>
            <h2 className="alma-giftcards-h1">A few <em>small things</em> worth knowing.</h2>
          </div>
          <details className="alma-giftcards-faq__item" open>
            <summary>Can it be used on tasting menus or set events?</summary>
            <p>Yes. Gift cards work for any food, drink, or service at the table — including the Thursday tasting menu at Avalon and private events. The only thing they don't cover is third-party tickets we resell (occasional cooking classes with guest chefs).</p>
          </details>
          <details className="alma-giftcards-faq__item">
            <summary>What if the amount doesn't get used in one visit?</summary>
            <p>The remaining balance stays on the same reference for next time. We'll show it on the receipt. They can check the balance at any time by emailing hello@alma.com.au with the reference, or asking at either venue.</p>
          </details>
          <details className="alma-giftcards-faq__item">
            <summary>Can I send it to someone overseas?</summary>
            <p>Yes — the card is delivered by email and is in Australian dollars. It can be redeemed only in person at Avalon or St. Alma, so it's most useful for someone who's visiting Sydney or living nearby.</p>
          </details>
          <details className="alma-giftcards-faq__item">
            <summary>Is there a physical card?</summary>
            <p>For now we deliver electronically — a clean PDF and Apple/Google Wallet pass. A printed letterpress version is on the way; in the meantime you can print the PDF on heavy stock yourself.</p>
          </details>
          <details className="alma-giftcards-faq__item">
            <summary>Refunds and exchanges?</summary>
            <p>If the card hasn't been redeemed or used in part, we'll refund within 14 days of purchase, no questions asked. After that the balance stays valid for three years from the date of issue.</p>
          </details>
          <details className="alma-giftcards-faq__item">
            <summary>For groups or corporate orders?</summary>
            <p>For ten cards or more, write to events@almagroup.com.au. We can branded-bundle them, send them all to one inbox for distribution, or to individual recipients. Volume pricing applies past 25 cards.</p>
          </details>
        </div>
      </section>

      <section className="alma-giftcards-reserve-strip" aria-label="Reserve a table">
        <h2 className="alma-giftcards-reserve-strip__title">Or take them, <em>yourself.</em></h2>
        <p>If you're the one going, skip the card and book the table.</p>
        <a href="https://alma-reserve.web.app/widget" className="alma-giftcards-btn alma-giftcards-btn--primary">
          Reserve a table
          <svg className="alma-giftcards-arrow" viewBox="0 0 14 6" fill="none" aria-hidden="true">
            <path d="M0 3 H13 M10 0 L13 3 L10 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </section>

      <footer className="alma-giftcards-footer">
        <div className="alma-giftcards-footer__row">
          <div>
            <img className="alma-giftcards-footer__logo" src="/images/alma-group-logo.png" alt="Alma Group" />
            <p className="alma-giftcards-footer__tagline">Coastal kitchens and bars on Sydney's Northern Beaches.</p>
          </div>
          <div>
            <h5>Venues</h5>
            <ul>
              <li><a href="https://www.almagroup.com.au/alma-avalon">alma Avalon</a></li>
              <li><a href="https://www.almagroup.com.au/st-alma">st. alma, Freshwater</a></li>
              <li><a href="https://www.almagroup.com.au/events">Private events</a></li>
            </ul>
          </div>
          <div>
            <h5>Eat &amp; drink</h5>
            <ul>
              <li><a href="https://www.almagroup.com.au/menu">Menu</a></li>
              <li><a href="https://alma-reserve.web.app/widget">Reservations</a></li>
              <li><a href="#configure">Gift cards</a></li>
            </ul>
          </div>
          <div>
            <h5>Alma group</h5>
            <ul>
              <li><a href="https://www.almagroup.com.au/about">About</a></li>
              <li><a href="https://www.almagroup.com.au/careers">Careers</a></li>
              <li><a href="https://www.almagroup.com.au/contact">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className="alma-giftcards-footer__legal">
          <span>© Alma Group · Avalon · Freshwater</span>
          <span>Made on Gadigal land</span>
          <a className="alma-giftcards-staff-link" href="/redeem">Staff redeem</a>
        </div>
      </footer>
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
          <div style={{ position: 'relative', width: '100%', maxWidth: 540, aspectRatio: '1.586 / 1', margin: '0 auto 18px' }}>
            <GiftCardArt
              design={isGiftCardDesign(card.design) ? card.design : 'forest'}
              amount={Math.round(card.balanceCents / 100)}
              code={card.code}
              recipient={card.recipientName ?? undefined}
            />
          </div>
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
  const navRef = useRef<HTMLDivElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  useDismissibleLayer(navRef, mobileMenuOpen, closeMobileMenu, 'giftcards-mobile-nav');
  const sectionFromLocation = useCallback(() => {
    if (window.location.pathname.startsWith('/orders')) return '/orders#recent';
    if (window.location.pathname.startsWith('/admin')) return '/admin#settings';
    if (window.location.pathname.startsWith('/activate')) return '/activate#activate';
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
    <div ref={navRef} className="mobile-nav-layer">
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
    </div>
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
          {!canEdit ? <p className="subtle">Admin access is required to change checkout settings.</p> : null}
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

      <Card title="Promo codes" subtitle="Admin users can add or remove promo codes. Managers can see what is active.">
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
  const orderActionItems = giftCards.filter((item) =>
    item.status === 'PENDING_PAYMENT' ||
    Boolean(item.emailError) ||
    (item.status === 'EXPIRED' && item.balanceCents > 0)
  );
  const selectedCardActions = card
    ? [
        card.emailError ? 'Email delivery needs review.' : null,
        card.status === 'PENDING_PAYMENT' ? 'Payment has not been confirmed yet.' : null,
        card.status === 'EXPIRED' && card.balanceCents > 0 ? 'Card is expired with remaining value.' : null,
        card.status === 'CANCELLED' ? 'Card is cancelled and cannot be redeemed.' : null
      ].filter((item): item is string => Boolean(item))
    : [];
  const currentPath = window.location.pathname;
  const activeGiftCardPage = currentPath.startsWith('/admin')
    ? 'admin'
    : currentPath.startsWith('/orders')
      ? 'orders'
      : currentPath.startsWith('/activate')
        ? 'activate'
        : 'redeem';
  const pageCopy = {
    redeem: {
      eyebrow: 'Daily workflow',
      title: 'Redeem gift cards',
      description: 'Check a card balance, redeem the amount used, and print a customer copy when needed.'
    },
    orders: {
      eyebrow: 'Orders',
      title: 'Gift card orders',
      description: 'Review recent cards, active balances, and order status without changing setup.'
    },
    admin: {
      eyebrow: 'Setup',
      title: 'Gift card setup',
      description: 'Manage public checkout copy, artwork, test checkout, and promo codes.'
    },
    activate: {
      eyebrow: 'At the counter',
      title: 'Activate physical gift card',
      description: 'Sell a pre-printed card at the venue. Scan or type the printed code, enter the amount paid, and the card goes live immediately.'
    }
  }[activeGiftCardPage];

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
              <SuiteNotificationsWidget api={api} currentApp="giftcards" />
              <SuiteFeedbackWidget appId="GIFTCARDS" api={api} userName={`${user.firstName} ${user.lastName}`} />
              <Button type="button" variant="secondary" onClick={() => void onLogout()}>Sign out</Button>
            </>
          }
        />
      }
    >
      <div className="giftcards-page">
        {(() => {
          const outstandingCents = giftCards
            .filter((c) => !c.testMode && c.status === 'ACTIVE')
            .reduce((sum, c) => sum + c.balanceCents, 0);
          const activeCount = giftCards.filter((c) => !c.testMode && c.status === 'ACTIVE').length;
          const outstandingLabel = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(outstandingCents / 100);
          return (
            <AlmaHomeBubble
              app="giftcards"
              appName="Gift Cards"
              appIcon={<DocumentIcon />}
              eyebrow="Gift card command"
              description={`Sell, redeem, reconcile. The card register holds ${outstandingLabel} in outstanding balance across ${activeCount} active cards.`}
              statusLabel="Week to date"
              statusHint={(() => {
                if (loading) return 'Loading card data…';
                if (message && !messageTarget) return 'Could not refresh gift cards.';
                if (orderActionItems.length === 0) return 'No fulfilment items pending.';
                return `${orderActionItems.length} order action${orderActionItems.length === 1 ? '' : 's'} waiting.`;
              })()}
              statusDot={orderActionItems.length > 0 ? 'amber' : 'forest'}
              actions={
                <>
                  <button
                    type="button"
                    className="alma-home-bubble-btn alma-home-bubble-btn--primary"
                    onClick={() => window.location.assign('/redeem')}
                  >
                    Sell a card →
                  </button>
                  <button
                    type="button"
                    className="alma-home-bubble-btn alma-home-bubble-btn--ghost"
                    onClick={() => window.location.assign('/orders')}
                  >
                    Open ledger
                  </button>
                </>
              }
            />
          );
        })()}
        {activeGiftCardPage === 'orders' ? (
          <Card title="Order search" subtitle="Find a gift card by code, purchaser, recipient, or email.">
            <Input label="Search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Code, name, email" />
          </Card>
        ) : null}
        {message && !messageTarget ? <p className={message.includes('Could') || message.includes('not') || message.includes('low') ? 'error-text' : 'subtle'}>{message}</p> : null}
        {activeGiftCardPage === 'orders' ? (
          <>
            {/* Revenue dashboard — month-over-month view of issued/redeemed/outstanding */}
            {(() => {
              const now = new Date();
              const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
              const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
              const prevMonthEnd = monthStart;
              const issuedThisMonth = giftCards.filter((c) => !c.testMode && c.paidAt && new Date(c.paidAt) >= monthStart);
              const issuedLastMonth = giftCards.filter((c) => !c.testMode && c.paidAt && new Date(c.paidAt) >= prevMonthStart && new Date(c.paidAt) < prevMonthEnd);
              const issuedThisCents = issuedThisMonth.reduce((s, c) => s + c.initialValueCents, 0);
              const issuedLastCents = issuedLastMonth.reduce((s, c) => s + c.initialValueCents, 0);
              const redeemedThisCents = giftCards.reduce((sum, c) => {
                return sum + c.redemptions.filter((r) => new Date(r.createdAt) >= monthStart).reduce((s, r) => s + r.amountCents, 0);
              }, 0);
              const redeemedLastCents = giftCards.reduce((sum, c) => {
                return sum + c.redemptions.filter((r) => new Date(r.createdAt) >= prevMonthStart && new Date(r.createdAt) < prevMonthEnd).reduce((s, r) => s + r.amountCents, 0);
              }, 0);
              const outstandingCents = data?.totals.activeBalanceCents ?? 0;
              const issuedDelta = issuedLastCents > 0 ? ((issuedThisCents - issuedLastCents) / issuedLastCents) * 100 : null;
              const redeemedDelta = redeemedLastCents > 0 ? ((redeemedThisCents - redeemedLastCents) / redeemedLastCents) * 100 : null;
              const monthName = now.toLocaleDateString(undefined, { month: 'long' });
              return (
                <Card title="Revenue dashboard" subtitle={`${monthName} — issued, redeemed, and outstanding`}>
                  <div className="giftcards-revenue-grid">
                    <div className="giftcards-revenue-tile">
                      <span className="giftcards-revenue-eyebrow">Issued this month</span>
                      <strong className="giftcards-revenue-value">{formatCents(issuedThisCents)}</strong>
                      <span className="giftcards-revenue-meta">{issuedThisMonth.length} card{issuedThisMonth.length === 1 ? '' : 's'}</span>
                      {issuedDelta !== null ? (
                        <span className={`giftcards-revenue-delta is-${issuedDelta >= 0 ? 'positive' : 'danger'}`}>
                          {issuedDelta >= 0 ? '▲' : '▼'} {Math.abs(issuedDelta).toFixed(0)}% vs last month
                        </span>
                      ) : null}
                    </div>
                    <div className="giftcards-revenue-tile">
                      <span className="giftcards-revenue-eyebrow">Redeemed this month</span>
                      <strong className="giftcards-revenue-value">{formatCents(redeemedThisCents)}</strong>
                      <span className="giftcards-revenue-meta">Across {giftCards.filter((c) => c.redemptions.some((r) => new Date(r.createdAt) >= monthStart)).length} cards</span>
                      {redeemedDelta !== null ? (
                        <span className={`giftcards-revenue-delta is-${redeemedDelta >= 0 ? 'positive' : 'warning'}`}>
                          {redeemedDelta >= 0 ? '▲' : '▼'} {Math.abs(redeemedDelta).toFixed(0)}% vs last month
                        </span>
                      ) : null}
                    </div>
                    <div className="giftcards-revenue-tile is-liability">
                      <span className="giftcards-revenue-eyebrow">Outstanding liability</span>
                      <strong className="giftcards-revenue-value">{formatCents(outstandingCents)}</strong>
                      <span className="giftcards-revenue-meta">{data?.totals.active ?? 0} active card{(data?.totals.active ?? 0) === 1 ? '' : 's'}</span>
                      <span className="giftcards-revenue-note">A leading indicator of repeat visits</span>
                    </div>
                  </div>
                </Card>
              );
            })()}

            <div className="stats-grid">
              <button type="button" className="stat-card-link" onClick={() => window.location.assign('/orders')} aria-label="Open active gift cards">
                <StatCard label="Active" value={data?.totals.active ?? 0} hint="Can be redeemed" loading={loading} />
              </button>
              <button type="button" className="stat-card-link" onClick={() => window.location.assign('/orders')} aria-label="Open redeemed gift cards">
                <StatCard label="Redeemed" value={data?.totals.redeemed ?? 0} hint="Fully used" loading={loading} />
              </button>
              <button type="button" className="stat-card-link" onClick={() => window.location.assign('/orders')} aria-label="Open gift card balance report">
                <StatCard label="Balance" value={formatCents(data?.totals.activeBalanceCents ?? 0)} hint="Outstanding liability" loading={loading} />
              </button>
              <button type="button" className="stat-card-link" onClick={() => window.location.assign('/orders')} aria-label="Open sold gift cards">
                <StatCard label="Sold" value={formatCents(data?.totals.soldValueCents ?? 0)} hint={`${data?.totals.test ?? 0} test cards excluded`} loading={loading} />
              </button>
            </div>
            <ActionPanel
              title="Order actions"
              description="Cards that need payment, email, expiry, or manager follow-up."
              count={orderActionItems.length}
              tone={orderActionItems.length ? 'warning' : 'positive'}
              empty={<p className="subtle">No gift card orders need action.</p>}
            >
              {orderActionItems.slice(0, 10).map((item) => (
                <div key={item.id} className="action-panel-row">
                  <span>
                    <strong>{item.code}</strong>
                    <small>
                      {item.recipientName || item.purchaserName} · {item.status.replace('_', ' ')}
                      {item.emailError ? ` · email issue: ${item.emailError}` : ''}
                      {item.status === 'EXPIRED' ? ` · ${formatCents(item.balanceCents)} remaining` : ''}
                    </small>
                  </span>
                  <span className="giftcards-inline-actions">
                    <Button type="button" size="sm" variant="secondary" onClick={() => window.location.assign(`/redeem?code=${encodeURIComponent(item.code)}`)}>
                      View card
                    </Button>
                    {item.status === 'ACTIVE' ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => window.open(giftCardPrintUrl(item.code), '_blank')}>
                        Print
                      </Button>
                    ) : null}
                  </span>
                </div>
              ))}
              {orderActionItems.length > 10 ? <p className="subtle">{orderActionItems.length - 10} more orders need review.</p> : null}
            </ActionPanel>
            <Card title="Recent cards" subtitle="Latest sales and balances" padding="none">
              {loading ? <Spinner label="Loading gift cards..." /> : null}
              {!loading && giftCards.length === 0 ? <EmptyState title="No gift cards yet" description="Paid checkouts will appear here." /> : null}
              <div className="giftcards-list">
                {giftCards.map((item) => (
                  <button key={item.id} type="button" onClick={() => window.location.assign(`/redeem?code=${encodeURIComponent(item.code)}`)}>
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
          </>
        ) : null}

        {activeGiftCardPage === 'redeem' ? (
          <Card
            title="Quick balance check & redemption"
            subtitle="Enter a code to see remaining balance instantly. Redemption form only appears after a card is loaded."
          >
            <form className="giftcards-form giftcards-balance-check" onSubmit={(event) => void lookup(event)}>
              <Input
                label="Gift card code"
                required
                value={code}
                onChange={(event) => setCode(event.currentTarget.value.toUpperCase())}
                placeholder="ALMA-XXXXXXXX"
                autoFocus
              />
              <div className="toolbar-right">
                <ActionFeedback
                  message={messageTarget === 'lookup' ? message : null}
                  tone={message?.includes('not') || message?.includes('Could') ? 'error' : 'success'}
                />
                <Button type="submit">Check balance</Button>
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
                <ActionPanel
                  title="Card actions"
                  description="Expand when this card needs manager follow-up."
                  count={selectedCardActions.length}
                  tone={selectedCardActions.length ? 'warning' : 'positive'}
                  empty={<p className="subtle">This card has no action flags.</p>}
                >
                  {selectedCardActions.map((item) => (
                    <div key={item} className="action-panel-row">
                      <span>
                        <strong>{item}</strong>
                        <small>{card.code} · {card.purchaserEmail}</small>
                      </span>
                      <span className="giftcards-inline-actions">
                        <Button type="button" size="sm" variant="secondary" onClick={() => window.open(giftCardPrintUrl(card.code), '_blank')}>Print</Button>
                        {card.status !== 'CANCELLED' && card.status !== 'EXPIRED' ? <Badge tone="info">Use cancel section below if needed</Badge> : null}
                      </span>
                    </div>
                  ))}
                </ActionPanel>
                <div className="form-grid two">
                  <Input label="Redeem amount" required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} />
                  <Select label="Venue" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} options={VENUES.map((item) => ({ label: item, value: item }))} />
                </div>
                <Textarea label="Notes" rows={2} value={notes} onChange={(event) => setNotes(event.currentTarget.value)} />
                {(() => {
                  // Panic-proof redeem block: concrete button label
                  // ("Redeem $50.00"), disable for invalid/over-balance,
                  // explicit warning if the amount exceeds the balance.
                  const amountCents = Math.round((Number(amount) || 0) * 100);
                  const validAmount = amountCents > 0;
                  const overBalance = validAmount && card && amountCents > card.balanceCents;
                  const cardActive = Boolean(card && card.status === 'ACTIVE');
                  const disableRedeem = !card || !cardActive || !validAmount || Boolean(overBalance);
                  const buttonLabel = validAmount
                    ? `Redeem ${formatCents(amountCents)}`
                    : 'Enter amount to redeem';
                  return (
                    <>
                      {overBalance ? (
                        <p className="giftcards-redeem-warning">
                          That's more than the remaining balance of <strong>{formatCents(card!.balanceCents)}</strong>. Lower the redeem amount.
                        </p>
                      ) : null}
                      <div className="giftcards-inline-actions">
                        <ActionFeedback
                          message={messageTarget === 'redeem' ? message : null}
                          tone={message?.includes('Could') || message?.includes('low') ? 'error' : 'success'}
                        />
                        <Button type="submit" disabled={disableRedeem}>{buttonLabel}</Button>
                        <Button type="button" variant="secondary" onClick={() => window.open(giftCardPrintUrl(card.code), '_blank')}>Print receipt</Button>
                      </div>
                    </>
                  );
                })()}
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
        ) : null}

        {activeGiftCardPage === 'admin' ? <GiftCardAdminSettings user={user} /> : null}
        {activeGiftCardPage === 'activate' ? <PhysicalActivationPanel user={user} /> : null}
      </div>
    </AppShell>
  );
}

function PhysicalActivationPanel({ user }: { user: AuthUser }) {
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('100');
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const [activated, setActivated] = useState<GiftCard | null>(null);

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setActivated(null);
    const trimmed = code.trim().toUpperCase();
    const initialValueCents = Math.round(Number(amount) * 100);
    if (!trimmed) {
      setMessage('Enter the printed code.');
      setMessageTone('error');
      return;
    }
    if (!Number.isFinite(initialValueCents) || initialValueCents < 500) {
      setMessage('Enter an amount of at least $5.');
      setMessageTone('error');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api<GiftCard>('/api/gift-cards/physical/activate', {
        method: 'POST',
        body: JSON.stringify({
          code: trimmed,
          initialValueCents,
          recipientName: recipientName.trim() || null,
          recipientEmail: recipientEmail.trim() || null,
          purchaserName: `${user.firstName} ${user.lastName}`.trim() || 'Counter sale',
          purchaserEmail: user.email ?? null
        })
      });
      setActivated(result);
      setMessage(`Activated ${trimmed} · ${formatCents(initialValueCents)} ready to redeem.`);
      setMessageTone('success');
      setCode('');
      setAmount('100');
      setRecipientName('');
      setRecipientEmail('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not activate card');
      setMessageTone('error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card
      title="Activate a physical card"
      subtitle="Scan or type the printed code from the back of the card, enter what the guest paid, and tap Activate. The card is live the moment you submit."
    >
      <form className="giftcards-form giftcards-balance-check" onSubmit={activate}>
        <Input
          label="Printed card code"
          required
          value={code}
          onChange={(event) => setCode(event.currentTarget.value.toUpperCase())}
          placeholder="ALMA-XXXXXXXX"
          autoFocus
        />
        <div className="form-grid two">
          <Input
            label="Initial value (AUD)"
            type="number"
            min="5"
            step="5"
            required
            value={amount}
            onChange={(event) => setAmount(event.currentTarget.value)}
          />
          <Input
            label="Recipient name (optional)"
            value={recipientName}
            onChange={(event) => setRecipientName(event.currentTarget.value)}
            placeholder="For a personalised email receipt"
          />
        </div>
        <Input
          label="Recipient email (optional)"
          type="email"
          value={recipientEmail}
          onChange={(event) => setRecipientEmail(event.currentTarget.value)}
          placeholder="They'll get a digital receipt"
        />
        <div className="toolbar-right">
          <ActionFeedback message={message} tone={messageTone} />
          <Button type="submit" disabled={submitting}>{submitting ? 'Activating…' : 'Activate'}</Button>
        </div>
      </form>

      {activated ? (
        <div className="giftcards-balance-card" style={{ marginTop: 16 }}>
          <strong>{activated.code}</strong>
          <span>{formatCents(activated.balanceCents)} remaining of {formatCents(activated.initialValueCents)}</span>
          <Badge tone={statusTone(activated.status)}>{activated.status.replace('_', ' ')}</Badge>
        </div>
      ) : null}
    </Card>
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
