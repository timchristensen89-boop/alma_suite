import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuthUser,
  GuestTimelinePayload,
  GuestTag,
  GuestTagType,
  MarketingAutomation,
  MarketingAutomationTriggerType,
  MarketingCampaign,
  MarketingChannel,
  MarketingContentAsset,
  MarketingContentAssetType,
  MarketingContentCalendarResponse,
  MarketingContentDashboardSummary,
  MarketingContentHelper,
  MarketingContentPlatformPreview,
  MarketingContentPost,
  MarketingContentUploadConfigResponse,
  MarketingEmailTemplate,
  MarketingOverview,
  MarketingSegmentDefinition,
  MarketingSegmentPreviewPayload,
  ReserveGuest,
  ReserveReservation,
  SocialPlatform
} from '@alma/shared';
import {
  ActionFeedback,
  AlmaHomeBubble,
  AppShell,
  Badge,
  Button,
  Card,
  ChartIcon,
  DocumentIcon,
  EmptyState,
  GearIcon,
  Input,
  ProductLogo,
  SearchIcon,
  Select,
  Spinner,
  StatCard,
  SUITE_APPS,
  SuiteAppSwitcher,
  SuiteClock,
  SuiteFeedbackWidget,
  SuiteInboxWidget,
  Textarea,
  ThemeToggle,
  TopBar,
  useDismissibleLayer
} from '@alma/ui';
import { SuiteSignOutButton } from '@alma/ui';
import { MARKETING_WEB_URL, RESERVE_WEB_URL, withSuiteAppLinks } from './config/suiteLinks';
import { api, clearApiAuthToken, consumeSuiteHandoffToken, installSuiteHandoff, setApiAuthToken } from './lib/api';

const suiteApps = withSuiteAppLinks(SUITE_APPS);
const ALL_VENUES = 'All venues';
const KNOWN_VENUES = ['Alma Avalon', 'St Alma'];
const TAG_TYPES: GuestTagType[] = ['MANUAL', 'AUTOMATIC', 'SYSTEM', 'CUSTOM'];
const CAMPAIGN_CHANNELS: MarketingChannel[] = ['EMAIL', 'SMS'];
const SOCIAL_PLATFORMS: SocialPlatform[] = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK'];
const CONTENT_ASSET_TYPES: MarketingContentAssetType[] = ['IMAGE', 'VIDEO', 'DOCUMENT'];
const CONTENT_PILLARS = [
  'food',
  'drinks',
  'events',
  'staff',
  'behind_the_scenes',
  'gift_cards',
  'bookings',
  'functions',
  'community',
  'other'
];
const AUTOMATION_TRIGGERS: MarketingAutomationTriggerType[] = [
  'FIRST_VISIT_COMPLETED',
  'REPEAT_VISIT',
  'LAPSED_GUEST',
  'BIRTHDAY_UPCOMING',
  'RESERVATION_CREATED',
  'RESERVATION_CANCELLED',
  'NO_SHOW',
  'BIG_SPENDER'
];
const TEMPLATE_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
const MARKETING_NAV_ITEMS = [
  { href: '/', label: 'Overview', description: 'Metrics, alerts, and activity', icon: <DocumentIcon /> },
  { href: '/guests', label: 'Guests', description: 'Profiles, consent, and tags', icon: <SearchIcon /> },
  { href: '/segments', label: 'Segments', description: 'Tag and audience logic', icon: <GearIcon /> },
  { href: '/campaigns', label: 'Campaigns', description: 'Preview and simulate', icon: <DocumentIcon /> },
  { href: '/content', label: 'Content', description: 'Social overview', icon: <DocumentIcon /> },
  { href: '/content/assets', label: 'Assets', description: 'Upload and library', icon: <DocumentIcon /> },
  { href: '/content/composer', label: 'Composer', description: 'Draft and preview posts', icon: <DocumentIcon /> },
  { href: '/content/calendar', label: 'Calendar', description: 'Scheduled social posts', icon: <DocumentIcon /> },
  { href: '/content/approvals', label: 'Approvals', description: 'Review social posts', icon: <DocumentIcon /> },
  { href: '/content/performance', label: 'Performance', description: 'Reach, likes, comments — Meta read-back', icon: <ChartIcon /> },
  { href: '/automations', label: 'Automations', description: 'Trigger-based drafts', icon: <GearIcon /> },
  { href: '/templates', label: 'Templates', description: 'Reusable email content', icon: <DocumentIcon /> }
];

type FeedbackTone = 'success' | 'error';

type FeedbackState = {
  target: string | null;
  message: string | null;
  tone: FeedbackTone;
};

type TagForm = {
  venue: string;
  name: string;
  description: string;
  type: GuestTagType;
  color: string;
};

type SegmentBuilder = {
  venue: string;
  channel: MarketingChannel;
  search: string;
  tagId: string;
  excludedTagId: string;
  marketingOptInOnly: boolean;
  emailOnly: boolean;
  includeUnsubscribed: boolean;
  minVisits: string;
  maxVisits: string;
  maxDaysSinceVisit: string;
  lastVisitWithinDays: string;
  birthdaysWithinDays: string;
  minSpendCents: string;
  hasUpcomingReservation: boolean;
  hasGiftCardPurchase: boolean;
};

type TemplateForm = {
  venue: string;
  name: string;
  subject: string;
  previewText: string;
  htmlBody: string;
  textBody: string;
  status: (typeof TEMPLATE_STATUSES)[number];
};

type CampaignForm = {
  venue: string;
  name: string;
  channel: MarketingChannel;
  audienceName: string;
  subject: string;
  previewText: string;
  body: string;
  textBody: string;
};

type AutomationForm = {
  venue: string;
  name: string;
  triggerType: MarketingAutomationTriggerType;
  emailTemplateId: string;
  delayHours: string;
  active: boolean;
};

type ContentAssetForm = {
  venue: string;
  title: string;
  description: string;
  assetType: MarketingContentAssetType;
  mimeType: string;
  fileName: string;
  fileSizeBytes: string;
  publicUrl: string;
  thumbnailUrl: string;
  tags: string;
};

type ContentPostForm = {
  venue: string;
  title: string;
  caption: string;
  contentPillar: string;
  targetChannels: SocialPlatform[];
  scheduledAt: string;
  assetId: string;
};

type MarketingGuestDetail = {
  guest: ReserveGuest;
  reservations: ReserveReservation[];
  timeline?: GuestTimelinePayload;
};

type CampaignPreviewResult = MarketingSegmentPreviewPayload & {
  simulated?: boolean;
  message?: string;
};

type ContentPublishPreviewResult = {
  post: MarketingContentPost;
  previews: MarketingContentPlatformPreview[];
  attempts?: Array<{
    id: string;
    platform: SocialPlatform;
    status: string;
    mode: string;
    errorMessage: string | null;
  }>;
  message?: string;
};

type ContentLivePublishState = {
  ready: boolean;
  label: string;
  title: string;
};

function defaultFeedback(): FeedbackState {
  return { target: null, message: null, tone: 'success' };
}

function isAdmin(user: AuthUser) {
  return Boolean(user.isAdmin || user.role === 'ADMIN');
}

function livePublishInfo(preview: MarketingContentPlatformPreview) {
  const livePublish = (preview.requestPreview as { livePublish?: unknown }).livePublish;
  if (!livePublish || typeof livePublish !== 'object') {
    return { ready: false, setupRequired: true };
  }
  return livePublish as {
    ready?: boolean;
    setupRequired?: boolean;
    accountConfigured?: boolean;
    hasTokenSecretRef?: boolean;
    connectorEnabled?: boolean;
    platformSupported?: boolean;
  };
}

function livePublishStateForPost(post: MarketingContentPost, preview: ContentPublishPreviewResult | null): ContentLivePublishState {
  if (!preview || preview.post.id !== post.id) {
    return {
      ready: false,
      label: 'Preview first',
      title: 'Preview this post to check live publishing readiness before posting.'
    };
  }

  const blocking = preview.previews.find((row) => row.status !== 'READY_TO_SIMULATE' || !livePublishInfo(row).ready);
  if (!blocking) {
    return {
      ready: true,
      label: 'Live publish',
      title: 'Publish to the connected live social accounts.'
    };
  }

  const info = livePublishInfo(blocking);
  if (blocking.status !== 'READY_TO_SIMULATE') {
    return { ready: false, label: 'Live setup required', title: blocking.message };
  }
  if (info.platformSupported === false) {
    return { ready: false, label: 'Live setup required', title: `${blocking.platform} live publishing is not implemented yet.` };
  }
  if (info.connectorEnabled === false) {
    return { ready: false, label: 'Live setup required', title: 'Admin must enable MARKETING_SOCIAL_LIVE_PUBLISH_ENABLED before live posting.' };
  }
  if (!info.accountConfigured || !info.hasTokenSecretRef) {
    return { ready: false, label: 'Live setup required', title: `${blocking.platform} needs a connected account and token secret reference in Admin.` };
  }
  return { ready: false, label: 'Live setup required', title: blocking.message };
}

function venueOptions(user: AuthUser) {
  return isAdmin(user)
    ? [{ label: ALL_VENUES, value: ALL_VENUES }, ...KNOWN_VENUES.map((venue) => ({ label: venue, value: venue }))]
    : [{ label: user.venue || KNOWN_VENUES[0]!, value: user.venue || KNOWN_VENUES[0]! }];
}

function scopedVenue(user: AuthUser, value: string) {
  if (!isAdmin(user)) return user.venue || KNOWN_VENUES[0]!;
  return value;
}

function defaultTagForm(venue: string): TagForm {
  return {
    venue,
    name: '',
    description: '',
    type: 'MANUAL',
    color: '#BE3455'
  };
}

function defaultSegmentBuilder(venue: string): SegmentBuilder {
  return {
    venue,
    channel: 'EMAIL',
    search: '',
    tagId: '',
    excludedTagId: '',
    marketingOptInOnly: true,
    emailOnly: true,
    includeUnsubscribed: false,
    minVisits: '',
    maxVisits: '',
    maxDaysSinceVisit: '',
    lastVisitWithinDays: '',
    birthdaysWithinDays: '',
    minSpendCents: '',
    hasUpcomingReservation: false,
    hasGiftCardPurchase: false
  };
}

function defaultTemplateForm(venue: string): TemplateForm {
  return {
    venue,
    name: 'Birthday invite',
    subject: 'A little something for your next visit',
    previewText: 'Thank you for dining with us recently.',
    htmlBody: '<h1>Hi {{firstName}}</h1><p>We would love to welcome you back to {{venueName}} soon.</p><p><a href="{{bookingLink}}">Book a table</a></p>',
    textBody: 'Hi {{firstName}}, we would love to welcome you back to {{venueName}} soon. Book here: {{bookingLink}}',
    status: 'DRAFT'
  };
}

function defaultCampaignForm(venue: string): CampaignForm {
  return {
    venue,
    name: 'Repeat guest dinner invite',
    channel: 'EMAIL',
    audienceName: 'Repeat guests',
    subject: 'Come back to {{venueName}}',
    previewText: 'A note for guests who already know the room.',
    body: '<h1>Hi {{firstName}}</h1><p>We would love to see you again at {{venueName}}.</p><p><a href="{{bookingLink}}">Book your next table</a></p>',
    textBody: 'Hi {{firstName}}, we would love to see you again at {{venueName}}. Book here: {{bookingLink}}'
  };
}

function defaultAutomationForm(venue: string): AutomationForm {
  return {
    venue,
    name: 'Birthday upcoming invite',
    triggerType: 'BIRTHDAY_UPCOMING',
    emailTemplateId: '',
    delayHours: '0',
    active: false
  };
}

function defaultContentAssetForm(venue: string): ContentAssetForm {
  return {
    venue,
    title: 'Weekend special photo',
    description: 'Hero image for a dining-room social post.',
    assetType: 'IMAGE',
    mimeType: 'image/jpeg',
    fileName: 'weekend-special.jpg',
    fileSizeBytes: '1200000',
    publicUrl: '',
    thumbnailUrl: '',
    tags: 'food, weekend'
  };
}

function defaultContentPostForm(venue: string): ContentPostForm {
  return {
    venue,
    title: 'Weekend booking push',
    caption: 'Tables are open this weekend at {{venueName}}. Book your spot and make a night of it.',
    contentPillar: 'bookings',
    targetChannels: ['FACEBOOK', 'INSTAGRAM'],
    scheduledAt: '',
    assetId: ''
  };
}

function fullName(guest: ReserveGuest | null | undefined) {
  if (!guest) return 'Unnamed guest';
  return `${guest.firstName} ${guest.lastName}`.trim();
}

function shortDate(value: string | null) {
  if (!value) return 'No date';
  return new Date(value).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
}

function dateTimeLabel(value: string) {
  return new Date(value).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function prettyLabel(value: string) {
  return value.replace(/_/g, ' ').toLowerCase();
}

type PreviewMergeContext = {
  firstName: string;
  venueName: string;
  bookingLink: string;
  unsubscribeLink: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderMergeFields(template: string, context: PreviewMergeContext) {
  return template
    .replaceAll('{{firstName}}', escapeHtml(context.firstName))
    .replaceAll('{{venueName}}', escapeHtml(context.venueName))
    .replaceAll('{{bookingLink}}', escapeHtml(context.bookingLink))
    .replaceAll('{{unsubscribeLink}}', escapeHtml(context.unsubscribeLink));
}

function htmlPreviewDocument(subject: string, previewText: string, body: string, context: PreviewMergeContext) {
  const renderedSubject = renderMergeFields(subject, context);
  const renderedPreviewText = renderMergeFields(previewText, context);
  const renderedBody = renderMergeFields(body, context);
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${renderedSubject}</title><style>body{font-family:Inter,Arial,sans-serif;margin:24px;color:#101828}a{color:#BE3455}.preview-text{margin:0 0 16px;color:#667085;font-size:14px}</style></head><body>${renderedPreviewText ? `<p class="preview-text">${renderedPreviewText}</p>` : ''}${renderedBody}</body></html>`;
}

function buildSegmentDefinition(form: SegmentBuilder): MarketingSegmentDefinition {
  return {
    venue: form.venue === ALL_VENUES ? '' : form.venue,
    search: form.search,
    guestIds: [],
    tagIds: form.tagId ? [form.tagId] : [],
    excludedTagIds: form.excludedTagId ? [form.excludedTagId] : [],
    marketingOptInOnly: form.marketingOptInOnly,
    emailOnly: form.channel === 'EMAIL' ? form.emailOnly : false,
    includeUnsubscribed: form.includeUnsubscribed,
    minVisits: form.minVisits ? Number(form.minVisits) : undefined,
    maxVisits: form.maxVisits ? Number(form.maxVisits) : undefined,
    maxDaysSinceVisit: form.maxDaysSinceVisit ? Number(form.maxDaysSinceVisit) : undefined,
    lastVisitOlderThanDays: form.maxDaysSinceVisit ? Number(form.maxDaysSinceVisit) : undefined,
    lastVisitWithinDays: form.lastVisitWithinDays ? Number(form.lastVisitWithinDays) : undefined,
    birthdaysWithinDays: form.birthdaysWithinDays ? Number(form.birthdaysWithinDays) : undefined,
    minSpendCents: form.minSpendCents ? Number(form.minSpendCents) : undefined,
    hasUpcomingReservation: form.hasUpcomingReservation || undefined,
    hasGiftCardPurchase: form.hasGiftCardPurchase || undefined
  };
}

function useMarketingAuth() {
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
        <ProductLogo appId="marketing" size="lg" />
        <Card title="Sign in" subtitle="Use your ALMA manager account to open Marketing">
          <form className="login-form" onSubmit={handleSubmit}>
            <Input label="Email" type="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
            <Input label="Password" type="password" required value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
            {message ? <p className="error-text">{message}</p> : null}
            <Button type="submit" disabled={submitting}>{submitting ? 'Signing in...' : 'Sign in'}</Button>
          </form>
        </Card>
        <SuiteAppSwitcher currentApp="marketing" apps={suiteApps} />
      </div>
    </main>
  );
}

function legacyHashToPath(hash: string) {
  const legacyMap: Record<string, string> = {
    '#dashboard': '/',
    '#guests': '/guests',
    '#segments': '/segments',
    '#campaigns': '/campaigns',
    '#content': '/content',
    '#assets': '/content/assets',
    '#composer': '/content/composer',
    '#calendar': '/content/calendar',
    '#approvals': '/content/approvals',
    '#automations': '/automations',
    '#templates': '/templates'
  };
  return legacyMap[hash] ?? '/';
}

function currentMarketingPath() {
  if (window.location.hash) return legacyHashToPath(window.location.hash);
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return MARKETING_NAV_ITEMS.some((item) => item.href === path) ? path : '/';
}

function navigateMarketingPath(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function useMarketingActivePath() {
  const [activePath, setActivePath] = useState(currentMarketingPath);

  useEffect(() => {
    // Default landing is the content calendar — operators check upcoming
    // posts more often than the overview metrics.
    if (window.location.pathname === '/' && !window.location.hash) {
      window.history.replaceState(null, '', '/content/calendar');
      setActivePath('/content/calendar');
    }
    const syncPath = () => setActivePath(currentMarketingPath());
    syncPath();
    window.addEventListener('popstate', syncPath);
    window.addEventListener('hashchange', syncPath);
    return () => {
      window.removeEventListener('popstate', syncPath);
      window.removeEventListener('hashchange', syncPath);
    };
  }, []);

  return MARKETING_NAV_ITEMS.some((item) => item.href === activePath) ? activePath : '/';
}

function SidebarNav() {
  const navRef = useRef<HTMLDivElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const activePath = useMarketingActivePath();
  const active = MARKETING_NAV_ITEMS.find((item) => item.href === activePath) ?? MARKETING_NAV_ITEMS[0]!;
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  useDismissibleLayer(navRef, mobileMenuOpen, closeMobileMenu, 'marketing-mobile-nav');

  return (
    <div ref={navRef} className="mobile-nav-layer">
      <button
        className="mobile-nav-toggle"
        type="button"
        aria-expanded={mobileMenuOpen}
        aria-controls="marketing-mobile-nav"
        onClick={() => setMobileMenuOpen((open) => !open)}
      >
        <span className="mobile-nav-toggle-current">
          <span className="sidebar-nav-icon">{active.icon}</span>
          <span>{active.label}</span>
        </span>
        <span className="mobile-nav-toggle-caret" aria-hidden="true">⌄</span>
      </button>
      <ul id="marketing-mobile-nav" className={`sidebar-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <li className="sidebar-nav-section">Marketing</li>
        {MARKETING_NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              className={activePath === item.href ? 'active' : ''}
              onClick={(event) => {
                event.preventDefault();
                navigateMarketingPath(item.href);
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

// Draft persistence — keep an in-progress builder form across navigation and
// refreshes so an unsent campaign / unsaved post isn't lost. Merges the stored
// value over the current defaults so newly-added fields still get a default.
function usePersistentState<T>(key: string, initial: () => T) {
  const read = (k: string): T => {
    if (typeof window === 'undefined') return initial();
    try {
      const raw = window.localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw);
        const base = initial();
        if (base && typeof base === 'object' && !Array.isArray(base)) {
          return { ...(base as object), ...(parsed as object) } as T;
        }
        return parsed as T;
      }
    } catch {
      /* ignore corrupt/blocked storage */
    }
    return initial();
  };
  const [state, setState] = useState<T>(() => read(key));
  // When the scope key changes (e.g. the venue filter switches), load that
  // scope's own stored draft instead of carrying the previous venue's draft
  // over — which previously risked sending one venue's content under another.
  // This is React's documented "reset state when a prop changes" pattern; it
  // runs during render so the save effect below sees the new value (no race).
  const [scopeKey, setScopeKey] = useState(key);
  if (scopeKey !== key) {
    setScopeKey(key);
    setState(read(key));
  }
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [key, state]);
  return [state, setState] as const;
}

function MarketingWorkspace({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const activePath = useMarketingActivePath();
  const options = useMemo(() => venueOptions(user), [user]);
  const initialVenue = scopedVenue(user, isAdmin(user) ? ALL_VENUES : user.venue || KNOWN_VENUES[0]!);
  const [venueFilter, setVenueFilter] = useState(initialVenue);
  const [guestSearch, setGuestSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<FeedbackState>(defaultFeedback());
  const [overview, setOverview] = useState<MarketingOverview | null>(null);
  const [guests, setGuests] = useState<ReserveGuest[]>([]);
  const [selectedGuestIds, setSelectedGuestIds] = useState<string[]>([]);
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [guestDetail, setGuestDetail] = useState<MarketingGuestDetail | null>(null);
  const [segmentPreview, setSegmentPreview] = useState<MarketingSegmentPreviewPayload | null>(null);
  const [isLoadingSegmentPreview, setIsLoadingSegmentPreview] = useState(false);
  const [campaignPreview, setCampaignPreview] = useState<CampaignPreviewResult | null>(null);
  const [loadingCampaignId, setLoadingCampaignId] = useState<string | null>(null);
  const [contentDashboard, setContentDashboard] = useState<MarketingContentDashboardSummary | null>(null);
  const [contentAssets, setContentAssets] = useState<MarketingContentAsset[]>([]);
  const [contentPosts, setContentPosts] = useState<MarketingContentPost[]>([]);
  const [contentCalendar, setContentCalendar] = useState<MarketingContentCalendarResponse | null>(null);
  const [contentUploadConfig, setContentUploadConfig] = useState<MarketingContentUploadConfigResponse | null>(null);
  const [contentHelpers, setContentHelpers] = useState<MarketingContentHelper[]>([]);
  const [contentPublishPreview, setContentPublishPreview] = useState<ContentPublishPreviewResult | null>(null);
  // Per-automation run metrics — simulation counts and last run timestamp.
  // Real open/click rates require email-provider send integration (Phase 4+).
  const [automationMetrics, setAutomationMetrics] = useState<
    Array<{ automationId: string; totalRuns: number; simulatedCount: number; sentCount: number; skippedCount: number; lastRunAt: string | null }>
  >([]);

  const venueParam = venueFilter === ALL_VENUES ? '' : venueFilter;
  const defaultVenue = venueParam || user.venue || KNOWN_VENUES[0]!;
  const [tagForm, setTagForm] = useState<TagForm>(() => defaultTagForm(defaultVenue));
  const [segmentForm, setSegmentForm] = usePersistentState<SegmentBuilder>(`alma.marketing.segmentForm:${venueFilter}`, () => defaultSegmentBuilder(venueFilter));
  const [templateForm, setTemplateForm] = usePersistentState<TemplateForm>(`alma.marketing.templateForm:${defaultVenue}`, () => defaultTemplateForm(defaultVenue));
  const [campaignForm, setCampaignForm] = usePersistentState<CampaignForm>(`alma.marketing.campaignForm:${defaultVenue}`, () => defaultCampaignForm(defaultVenue));
  const [automationForm, setAutomationForm] = usePersistentState<AutomationForm>(`alma.marketing.automationForm:${defaultVenue}`, () => defaultAutomationForm(defaultVenue));
  const [contentAssetForm, setContentAssetForm] = useState<ContentAssetForm>(() => defaultContentAssetForm(defaultVenue));
  const [contentPostForm, setContentPostForm] = usePersistentState<ContentPostForm>(`alma.marketing.contentPostForm:${defaultVenue}`, () => defaultContentPostForm(defaultVenue));

  const tags = overview?.tags ?? [];
  const templates = overview?.templates ?? [];
  const campaigns = overview?.campaigns ?? [];
  const automations = overview?.automations ?? [];
  const recentReservations = overview?.recentReservations ?? [];
  const socialAccounts = contentDashboard?.socialAccounts ?? [];
  const postsNeedingReview = contentPosts.filter((post) => post.status === 'NEEDS_REVIEW');
  const upcomingContentPosts = contentCalendar?.posts ?? contentDashboard?.upcomingPosts ?? [];
  const activePage = MARKETING_NAV_ITEMS.find((item) => item.href === activePath) ?? MARKETING_NAV_ITEMS[0]!;
  const isActiveSection = (path: string) => activePath === path;
  const showContentSection = activePath.startsWith('/content');
  const showContentOverview = activePath === '/content';
  const showContentAssets = activePath === '/content/assets';
  const showContentComposer = activePath === '/content/composer';
  const showContentCalendar = showContentOverview || activePath === '/content/calendar';
  const showContentApprovals = showContentOverview || activePath === '/content/approvals';
  const showContentPerformance = activePath === '/content/performance';
  const previewGuest = guestDetail?.guest ?? guests[0] ?? null;
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === automationForm.emailTemplateId) ?? templates[0] ?? null,
    [automationForm.emailTemplateId, templates]
  );
  const previewContext = useMemo<PreviewMergeContext>(() => {
    const reserveBaseUrl = RESERVE_WEB_URL.replace(/\/+$/, '');
    const marketingBaseUrl = MARKETING_WEB_URL.replace(/\/+$/, '');
    return {
      firstName: previewGuest?.firstName?.trim() || 'Alex',
      venueName: defaultVenue || previewGuest?.venue || 'Alma Venue',
      bookingLink: `${reserveBaseUrl}/widget`,
      unsubscribeLink: `${marketingBaseUrl}/unsubscribe-preview`
    };
  }, [defaultVenue, previewGuest]);

  const load = useCallback(async () => {
    setLoading(true);
    setFeedback(defaultFeedback());
    try {
      const query = venueParam ? `?venue=${encodeURIComponent(venueParam)}` : '';
      const guestsQuery = new URLSearchParams();
      if (venueParam) guestsQuery.set('venue', venueParam);
      if (guestSearch) guestsQuery.set('search', guestSearch);
      const calendarQuery = new URLSearchParams();
      if (venueParam) calendarQuery.set('venue', venueParam);
      calendarQuery.set('from', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      calendarQuery.set('to', new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString());
      const [nextOverview, nextGuests, nextContentDashboard, nextAssets, nextPosts, nextCalendar, nextUploadConfig, nextContentHelpers] = await Promise.all([
        api<MarketingOverview>(`/api/marketing/overview${query}`),
        api<ReserveGuest[]>(`/api/marketing/guests?${guestsQuery.toString()}`),
        api<MarketingContentDashboardSummary>(`/api/marketing/content/dashboard${query}`),
        api<MarketingContentAsset[]>(`/api/marketing/content/assets${query}`),
        api<MarketingContentPost[]>(`/api/marketing/content/posts${query}`),
        api<MarketingContentCalendarResponse>(`/api/marketing/content/calendar?${calendarQuery.toString()}`),
        api<MarketingContentUploadConfigResponse>('/api/marketing/content/upload-config'),
        api<MarketingContentHelper[]>('/api/marketing/content/helpers')
      ]);
      setOverview(nextOverview);
      setGuests(nextGuests);
      setContentDashboard(nextContentDashboard);
      setContentAssets(nextAssets);
      setContentPosts(nextPosts);
      setContentCalendar(nextCalendar);
      setContentUploadConfig(nextUploadConfig);
      setContentHelpers(nextContentHelpers);
      // Metrics endpoint is optional — gracefully no-op if not deployed yet
      try {
        const metrics = await api<Array<{ automationId: string; totalRuns: number; simulatedCount: number; sentCount: number; skippedCount: number; lastRunAt: string | null }>>('/api/marketing/automations/metrics');
        setAutomationMetrics(metrics);
      } catch {
        setAutomationMetrics([]);
      }
    } catch (error) {
      setFeedback({
        target: 'page',
        tone: 'error',
        message: error instanceof Error ? error.message : 'Could not load Marketing workspace'
      });
    } finally {
      setLoading(false);
    }
  }, [guestSearch, venueParam]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadGuestDetail = useCallback(async (guestId: string): Promise<MarketingGuestDetail> => {
    const [detail, timeline] = await Promise.all([
      api<MarketingGuestDetail>(`/api/marketing/guests/${guestId}`),
      api<GuestTimelinePayload>(`/api/marketing/guests/${guestId}/timeline`)
    ]);
    return { ...detail, timeline };
  }, []);

  useEffect(() => {
    setTagForm(defaultTagForm(defaultVenue));
    setSegmentForm(defaultSegmentBuilder(venueFilter));
    setTemplateForm(defaultTemplateForm(defaultVenue));
    setCampaignForm(defaultCampaignForm(defaultVenue));
    setAutomationForm(defaultAutomationForm(defaultVenue));
    setContentAssetForm(defaultContentAssetForm(defaultVenue));
    setContentPostForm(defaultContentPostForm(defaultVenue));
  }, [defaultVenue, venueFilter]);

  useEffect(() => {
    if (!selectedGuestId) {
      setGuestDetail(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const detail = await loadGuestDetail(selectedGuestId);
        if (!cancelled) setGuestDetail(detail);
      } catch {
        if (!cancelled) setGuestDetail(null);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [loadGuestDetail, selectedGuestId]);

  function setSuccess(target: string, message: string) {
    setFeedback({ target, message, tone: 'success' });
  }

  function setError(target: string, error: unknown, fallback: string) {
    setFeedback({
      target,
      message: error instanceof Error ? error.message : fallback,
      tone: 'error'
    });
  }

  function toggleGuestSelection(guestId: string) {
    setSelectedGuestIds((current) =>
      current.includes(guestId) ? current.filter((id) => id !== guestId) : [...current, guestId]
    );
  }

  async function saveTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api<GuestTag>('/api/marketing/tags', {
        method: 'POST',
        body: JSON.stringify(tagForm)
      });
      setTagForm(defaultTagForm(defaultVenue));
      setSuccess('tag', 'Tag saved.');
      await load();
    } catch (error) {
      setError('tag', error, 'Could not save tag.');
    }
  }

  async function assignTag(guestId: string, tagId: string) {
    try {
      await api(`/api/marketing/guests/${guestId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tagId })
      });
      setSuccess('guest-tag', 'Tag applied.');
      await load();
      if (selectedGuestId === guestId) {
        const detail = await loadGuestDetail(guestId);
        setGuestDetail(detail);
      }
    } catch (error) {
      setError('guest-tag', error, 'Could not assign tag.');
    }
  }

  async function removeTag(guestId: string, tagId: string) {
    try {
      await api(`/api/marketing/guests/${guestId}/tags/${tagId}`, { method: 'DELETE' });
      setSuccess('guest-tag', 'Tag removed.');
      await load();
      if (selectedGuestId === guestId) {
        const detail = await loadGuestDetail(guestId);
        setGuestDetail(detail);
      }
    } catch (error) {
      setError('guest-tag', error, 'Could not remove tag.');
    }
  }

  async function recalculateTags(guestId?: string) {
    try {
      await api('/api/marketing/auto-tags/recalculate', {
        method: 'POST',
        body: JSON.stringify({
          venue: venueParam || undefined,
          guestId
        })
      });
      setSuccess('auto-tags', guestId ? 'Guest auto-tags recalculated.' : 'Venue auto-tags recalculated.');
      await load();
      if (guestId && selectedGuestId === guestId) {
        const detail = await loadGuestDetail(guestId);
        setGuestDetail(detail);
      }
    } catch (error) {
      setError('auto-tags', error, 'Could not recalculate auto-tags.');
    }
  }

  async function previewSegment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoadingSegmentPreview(true);
    try {
      const preview = await api<MarketingSegmentPreviewPayload>('/api/marketing/segments/preview', {
        method: 'POST',
        body: JSON.stringify({
          venue: venueParam || defaultVenue,
          channel: segmentForm.channel,
          segmentDefinition: buildSegmentDefinition(segmentForm)
        })
      });
      setSegmentPreview(preview);
      setSuccess('segment', 'Segment preview refreshed.');
    } catch (error) {
      setError('segment', error, 'Could not preview segment.');
    } finally {
      setIsLoadingSegmentPreview(false);
    }
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api<MarketingEmailTemplate>('/api/marketing/templates', {
        method: 'POST',
        body: JSON.stringify(templateForm)
      });
      setTemplateForm(defaultTemplateForm(defaultVenue));
      setSuccess('template', 'Template saved.');
      await load();
    } catch (error) {
      setError('template', error, 'Could not save template.');
    }
  }

  async function saveCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The segment is re-scoped to the campaign's venue on save. Warn if that
    // changes the audience the segment was built for, rather than doing it silently.
    if (segmentForm.venue && campaignForm.venue && segmentForm.venue !== campaignForm.venue) {
      if (
        !window.confirm(
          `This segment was built for "${segmentForm.venue}", but the campaign targets "${campaignForm.venue}". Saving will re-scope the audience to "${campaignForm.venue}". Continue?`
        )
      ) {
        return;
      }
    }
    try {
      await api<MarketingCampaign>('/api/marketing/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          ...campaignForm,
          venue: campaignForm.venue,
          status: 'DRAFT',
          guestIds: selectedGuestIds,
          segmentDefinition: buildSegmentDefinition({
            ...segmentForm,
            venue: campaignForm.venue,
            channel: campaignForm.channel
          })
        })
      });
      setCampaignForm(defaultCampaignForm(defaultVenue));
      setSelectedGuestIds([]);
      setSuccess('campaign', 'Campaign draft saved.');
      await load();
    } catch (error) {
      setError('campaign', error, 'Could not save campaign.');
    }
  }

  async function previewCampaignRecipients(campaignId: string) {
    setLoadingCampaignId(campaignId);
    try {
      const preview = await api<CampaignPreviewResult>(`/api/marketing/campaigns/${campaignId}/preview-recipients`, {
        method: 'POST'
      });
      setCampaignPreview(preview);
      setSuccess(`campaign-preview:${campaignId}`, 'Recipient preview refreshed.');
    } catch (error) {
      setError(`campaign-preview:${campaignId}`, error, 'Could not preview recipients.');
    } finally {
      setLoadingCampaignId(null);
    }
  }

  async function simulateCampaign(campaignId: string) {
    setLoadingCampaignId(campaignId);
    try {
      const preview = await api<CampaignPreviewResult>(`/api/marketing/campaigns/${campaignId}/simulate-send`, {
        method: 'POST'
      });
      setCampaignPreview(preview);
      setSuccess(`campaign-simulate:${campaignId}`, preview.message || 'Campaign simulation completed.');
      await load();
    } catch (error) {
      setError(`campaign-simulate:${campaignId}`, error, 'Could not simulate campaign.');
    } finally {
      setLoadingCampaignId(null);
    }
  }

  // Test send — sends ONE email to the user or a specified address so
  // they can preview the rendered email before triggering a live send.
  async function testSendCampaign(campaignId: string) {
    const defaultTo = user.email ?? '';
    const to = window.prompt('Send a test email to which address?', defaultTo);
    if (!to || !to.includes('@')) {
      setError(`campaign-test:${campaignId}`, new Error('Enter a valid email.'), 'Enter a valid email.');
      return;
    }
    setLoadingCampaignId(campaignId);
    try {
      const result = await api<{ message: string; delivered: boolean }>(`/api/marketing/campaigns/${campaignId}/test-send`, {
        method: 'POST',
        body: JSON.stringify({ to: to.trim().toLowerCase() })
      });
      if (result.delivered) {
        setSuccess(`campaign-test:${campaignId}`, result.message);
      } else {
        setError(`campaign-test:${campaignId}`, new Error(result.message), result.message);
      }
      await load();
    } catch (error) {
      setError(`campaign-test:${campaignId}`, error, 'Could not send the test email.');
    } finally {
      setLoadingCampaignId(null);
    }
  }

  // Live send — strict confirmation flow. The user has to type the
  // word SEND to confirm, and the API rejects without a recent test.
  async function liveSendCampaign(campaign: MarketingCampaign) {
    if (campaign.sentAt) {
      setError(`campaign-live:${campaign.id}`, new Error('Already sent'), 'This campaign has already been sent live.');
      return;
    }
    if (!campaign.simulatedAt) {
      window.alert('Send a test email to yourself first. Live sends are blocked until a test has been verified.');
      return;
    }
    const recipientCount = campaign.recipients.length || 0;
    const ack = window.prompt(
      `LIVE SEND — "${campaign.name}"\n\n` +
      `This will deliver real emails to ${recipientCount > 0 ? recipientCount : 'all matching'} recipients.\n` +
      `It cannot be undone.\n\n` +
      `Type SEND to confirm.`,
      ''
    );
    if (ack?.trim().toUpperCase() !== 'SEND') {
      setError(`campaign-live:${campaign.id}`, new Error('Cancelled'), 'Live send cancelled.');
      return;
    }
    setLoadingCampaignId(campaign.id);
    try {
      const result = await api<{ message: string; sent: number; failed: number; skipped: number }>(`/api/marketing/campaigns/${campaign.id}/live-send`, {
        method: 'POST',
        body: JSON.stringify({ confirmToken: campaign.id, override: false })
      });
      setSuccess(`campaign-live:${campaign.id}`, result.message);
      await load();
    } catch (error) {
      // If the API returned "needs override" wording, offer to retry with override.
      const message = error instanceof Error ? error.message : 'Could not send live.';
      if (message.includes('override=true')) {
        const ack2 = window.confirm(`${message}\n\nClick OK to send anyway.`);
        if (ack2) {
          try {
            const result = await api<{ message: string }>(`/api/marketing/campaigns/${campaign.id}/live-send`, {
              method: 'POST',
              body: JSON.stringify({ confirmToken: campaign.id, override: true })
            });
            setSuccess(`campaign-live:${campaign.id}`, result.message);
            await load();
            return;
          } catch (retryError) {
            setError(`campaign-live:${campaign.id}`, retryError, 'Could not send live with override.');
            return;
          }
        }
      }
      setError(`campaign-live:${campaign.id}`, error, 'Could not send live.');
    } finally {
      setLoadingCampaignId(null);
    }
  }

  async function issueGiftCardsForCampaign(campaignId: string) {
    const valueInput = window.prompt(
      'How much should each gift card be worth? (AUD, minimum 5)',
      '20'
    );
    if (!valueInput) return;
    const valueCents = Math.round(Number(valueInput) * 100);
    if (!Number.isFinite(valueCents) || valueCents < 500) {
      setError(`campaign-gift:${campaignId}`, null, 'Enter a value of at least $5.');
      return;
    }
    const expiryInput = window.prompt('Expiry in days? Leave blank for no expiry.', '90');
    const expiryDays = expiryInput && expiryInput.trim() ? Number(expiryInput) : undefined;
    try {
      const result = await api<{ issued: number; codes: Array<{ recipientName: string; recipientEmail: string | null; code: string }> }>(
        `/api/marketing/campaigns/${campaignId}/issue-gift-cards`,
        {
          method: 'POST',
          body: JSON.stringify({ valueCents, expiryDays })
        }
      );
      // Copy to clipboard as CSV so the operator can paste into an email merge
      const csv = ['Recipient,Email,Code', ...result.codes.map((c) => `${c.recipientName},${c.recipientEmail ?? ''},${c.code}`)].join('\n');
      try {
        await navigator.clipboard.writeText(csv);
        setSuccess(`campaign-gift:${campaignId}`, `Issued ${result.issued} gift cards. CSV copied to clipboard for email merge.`);
      } catch {
        setSuccess(`campaign-gift:${campaignId}`, `Issued ${result.issued} gift cards. (Clipboard unavailable — codes are saved in the Gift Cards app.)`);
      }
    } catch (error) {
      setError(`campaign-gift:${campaignId}`, error, 'Could not issue gift cards.');
    }
  }

  async function saveAutomation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!automationForm.emailTemplateId) {
      setError('automation', new Error('Select an email template before saving.'), 'Select an email template before saving.');
      return;
    }
    if (segmentForm.venue && automationForm.venue && segmentForm.venue !== automationForm.venue) {
      if (
        !window.confirm(
          `This segment was built for "${segmentForm.venue}", but the automation targets "${automationForm.venue}". Saving will re-scope the audience to "${automationForm.venue}". Continue?`
        )
      ) {
        return;
      }
    }
    try {
      await api<MarketingAutomation>('/api/marketing/automations', {
        method: 'POST',
        body: JSON.stringify({
          venue: automationForm.venue,
          name: automationForm.name,
          triggerType: automationForm.triggerType,
          emailTemplateId: automationForm.emailTemplateId,
          delayHours: Number(automationForm.delayHours || 0),
          active: automationForm.active,
          segmentDefinition: buildSegmentDefinition({
            ...segmentForm,
            venue: automationForm.venue,
            channel: 'EMAIL'
          })
        })
      });
      setAutomationForm(defaultAutomationForm(defaultVenue));
      setSuccess('automation', 'Automation saved.');
      await load();
    } catch (error) {
      setError('automation', error, 'Could not save automation.');
    }
  }

  async function installStarterAutomations() {
    if (!window.confirm('Add the starter automation library (First Visit, Cancellation, No Show, Re-engagement, Birthday, VIP Winback) for this venue? They install switched OFF so you can review the copy before turning them on.')) {
      return;
    }
    try {
      const result = await api<{ installed: number; skipped: number; total: number }>('/api/marketing/automations/install-library', {
        method: 'POST',
        body: JSON.stringify({ venue: automationForm.venue })
      });
      setSuccess('automation', `Installed ${result.installed} starter automation${result.installed === 1 ? '' : 's'}${result.skipped ? ` (${result.skipped} already existed)` : ''}. Review the copy, then switch them on.`);
      await load();
    } catch (error) {
      setError('automation', error, 'Could not install the starter automations.');
    }
  }

  async function simulateAutomation(automationId: string) {
    try {
      const result = await api<{ message: string; guestCount: number }>('/api/marketing/automations/' + automationId + '/simulate', {
        method: 'POST'
      });
      setSuccess(`automation:${automationId}`, `${result.message} ${result.guestCount} guests evaluated.`);
      await load();
    } catch (error) {
      setError(`automation:${automationId}`, error, 'Could not simulate automation.');
    }
  }

  function toggleContentChannel(channel: SocialPlatform) {
    setContentPostForm((current) => {
      const selected = current.targetChannels.includes(channel);
      const next = selected ? current.targetChannels.filter((item) => item !== channel) : [...current.targetChannels, channel];
      return { ...current, targetChannels: next.length > 0 ? next : [channel] };
    });
  }

  function applyContentHelper(helper: MarketingContentHelper) {
    setContentPostForm((current) => ({
      ...current,
      title: helper.label,
      caption: helper.caption,
      contentPillar: helper.contentPillar,
      targetChannels: helper.targetChannels
    }));
    setCampaignForm((current) => ({
      ...current,
      name: helper.label,
      audienceName: helper.label,
      subject: helper.campaignSubject,
      previewText: helper.campaignPreviewText,
      body: helper.campaignBody,
      textBody: helper.campaignPreviewText
    }));
    setSuccess('content-helper', `${helper.label} helper applied.`);
  }

  async function createPostFromHelper(helper: MarketingContentHelper) {
    try {
      const result = await api<{ post: MarketingContentPost }>(`/api/marketing/content/helpers/${helper.id}/create-post`, {
        method: 'POST',
        body: JSON.stringify({ venue: contentPostForm.venue || defaultVenue, scheduledAt: contentPostForm.scheduledAt })
      });
      setSuccess('content-helper', `${helper.label} draft created.`);
      setContentPostForm((current) => ({ ...current, title: result.post.title, caption: result.post.caption }));
      await load();
    } catch (error) {
      setError('content-helper', error, 'Could not create helper post.');
    }
  }

  async function createCampaignFromPost(postId: string) {
    try {
      await api(`/api/marketing/content/posts/${postId}/create-campaign`, { method: 'POST' });
      setSuccess(`content-post:${postId}`, 'Email campaign draft created and linked.');
      await load();
    } catch (error) {
      setError(`content-post:${postId}`, error, 'Could not create campaign from post.');
    }
  }

  async function createContentPostFromCampaign(campaignId: string) {
    try {
      await api(`/api/marketing/campaigns/${campaignId}/create-content-post`, { method: 'POST' });
      setSuccess(`campaign-preview:${campaignId}`, 'Social content draft created from campaign.');
      await load();
    } catch (error) {
      setError(`campaign-preview:${campaignId}`, error, 'Could not create social post from campaign.');
    }
  }

  async function saveContentAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const asset = await api<MarketingContentAsset>('/api/marketing/content/assets', {
        method: 'POST',
        body: JSON.stringify({
          ...contentAssetForm,
          storageProvider: 'EXTERNAL_URL',
          fileSizeBytes: Number(contentAssetForm.fileSizeBytes || 0),
          tags: contentAssetForm.tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          status: 'READY',
          source: 'UPLOAD'
        })
      });
      setContentAssetForm(defaultContentAssetForm(defaultVenue));
      setContentPostForm((current) => ({ ...current, assetId: asset.id }));
      setSuccess('content-asset', 'Asset uploaded and ready to attach.');
      await load();
    } catch (error) {
      setError('content-asset', error, 'Could not upload asset.');
    }
  }

  async function archiveContentAsset(assetId: string) {
    try {
      await api(`/api/marketing/content/assets/${assetId}`, { method: 'DELETE' });
      setSuccess('content-asset', 'Asset archived.');
      await load();
    } catch (error) {
      setError('content-asset', error, 'Could not archive asset.');
    }
  }

  async function saveContentPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const post = await api<MarketingContentPost>('/api/marketing/content/posts', {
        method: 'POST',
        body: JSON.stringify({
          venue: contentPostForm.venue,
          title: contentPostForm.title,
          caption: contentPostForm.caption,
          contentPillar: contentPostForm.contentPillar,
          targetChannels: contentPostForm.targetChannels,
          scheduledAt: contentPostForm.scheduledAt,
          approvalRequired: true,
          status: 'DRAFT'
        })
      });
      if (contentPostForm.assetId) {
        await api(`/api/marketing/content/posts/${post.id}/assets`, {
          method: 'POST',
          body: JSON.stringify({ assetId: contentPostForm.assetId, sortOrder: 0 })
        });
      }
      setContentPostForm(defaultContentPostForm(defaultVenue));
      setSuccess('content-post', 'Post draft saved.');
      await load();
      await previewContentPostPublish(post.id);
    } catch (error) {
      setError('content-post', error, 'Could not save post draft.');
    }
  }

  async function submitContentPost(postId: string) {
    try {
      await api(`/api/marketing/content/posts/${postId}/submit-review`, { method: 'POST' });
      setSuccess(`content-post:${postId}`, 'Post submitted for review.');
      await load();
    } catch (error) {
      setError(`content-post:${postId}`, error, 'Could not submit post.');
    }
  }

  async function approveContentPost(postId: string) {
    try {
      await api(`/api/marketing/content/posts/${postId}/approve`, { method: 'POST' });
      setSuccess(`content-post:${postId}`, 'Post approved.');
      await load();
    } catch (error) {
      setError(`content-post:${postId}`, error, 'Could not approve post.');
    }
  }

  async function scheduleContentPost(postId: string, scheduledAt: string | null) {
    if (!scheduledAt) {
      setError(`content-post:${postId}`, new Error('Choose a scheduled date/time first.'), 'Choose a scheduled date/time first.');
      return;
    }
    try {
      await api(`/api/marketing/content/posts/${postId}/schedule`, {
        method: 'POST',
        body: JSON.stringify({ scheduledAt })
      });
      setSuccess(`content-post:${postId}`, 'Post scheduled.');
      await load();
    } catch (error) {
      setError(`content-post:${postId}`, error, 'Could not schedule post.');
    }
  }

  async function previewContentPostPublish(postId: string) {
    try {
      const result = await api<ContentPublishPreviewResult>(`/api/marketing/content/posts/${postId}/preview-publish`, {
        method: 'POST'
      });
      setContentPublishPreview(result);
      setSuccess(`content-preview:${postId}`, 'Platform preview refreshed.');
    } catch (error) {
      setError(`content-preview:${postId}`, error, 'Could not preview social post.');
    }
  }

  async function simulateContentPostPublish(postId: string) {
    try {
      const result = await api<ContentPublishPreviewResult>(`/api/marketing/content/posts/${postId}/simulate-publish`, {
        method: 'POST'
      });
      setContentPublishPreview(result);
      setSuccess(`content-preview:${postId}`, result.message || 'Publish simulation completed.');
      await load();
    } catch (error) {
      setError(`content-preview:${postId}`, error, 'Could not simulate publish.');
    }
  }

  async function publishContentPostLive(postId: string) {
    try {
      const result = await api<ContentPublishPreviewResult>(`/api/marketing/content/posts/${postId}/publish`, {
        method: 'POST'
      });
      setContentPublishPreview(result);
      setSuccess(`content-preview:${postId}`, result.message || 'Live publish completed.');
      await load();
    } catch (error) {
      setError(`content-preview:${postId}`, error, 'Could not live publish this post.');
    }
  }

  return (
    <AppShell
      brand={<ProductLogo appId="marketing" size="md" showBrandMark={false} />}
      sidebar={<SidebarNav />}
      topBar={
        <TopBar
          title="ALMA Marketing"
          subtitle="Guest CRM, campaigns, content, and automations"
          right={
            <>
              <SuiteAppSwitcher currentApp="marketing" apps={suiteApps} variant="topbar" />
              <SuiteInboxWidget
                appId="MARKETING"
                api={api}
                currentApp="marketing"
                venue={user.venue}
                userName={`${user.firstName} ${user.lastName}`}
                canAnnounce={user.role !== 'STAFF'}
              />
              <SuiteFeedbackWidget appId="MARKETING" api={api} userName={`${user.firstName} ${user.lastName}`} />
              <ThemeToggle />
              <SuiteClock />
              <SuiteSignOutButton onClick={() => void onLogout()} />
            </>
          }
        />
      }
    >
      <div className="marketing-page">
        <div className="alma-preview-banner" role="status">
          <span className="alma-preview-banner-tag">Pilot</span>
          <span className="alma-preview-banner-text">
            <strong>Email campaigns can now send live.</strong> Every send requires a test first + an explicit "SEND" confirmation, admin role, and routes through the Resend / SMTP provider. Social posts and SMS remain simulated until publisher tokens are wired.
          </span>
        </div>
        <AlmaHomeBubble
          app="marketing"
          appName="Marketing"
          appIcon={<SearchIcon />}
          eyebrow="Marketing command"
          description="Guest CRM, segments, campaigns, content calendar, and automations — consent and preview status stay in view."
          statusLabel={activePage.label}
          statusHint={
            loading
              ? 'Loading marketing data…'
              : `${overview?.totals.guests ?? 0} guests · ${overview?.totals.optedInGuests ?? 0} opted in`
          }
          statusDot={(overview?.totals.lapsedGuests ?? 0) > 50 ? 'amber' : 'forest'}
          actions={
            <>
              <button
                type="button"
                className="alma-home-bubble-btn alma-home-bubble-btn--primary"
                onClick={() => void load()}
                disabled={loading}
              >
                Refresh →
              </button>
              <button
                type="button"
                className="alma-home-bubble-btn alma-home-bubble-btn--ghost"
                onClick={() => navigateMarketingPath('/guests')}
              >
                Guest CRM
              </button>
            </>
          }
        />

        <div className="marketing-page-filters">
          <Select label="Venue" value={venueFilter} onChange={(event) => setVenueFilter(event.currentTarget.value)} options={options} />
          <Input label="Guest search" value={guestSearch} onChange={(event) => setGuestSearch(event.currentTarget.value)} placeholder="Name, email, or phone" />
        </div>

        {feedback.target === 'page' && feedback.message ? <p className="error-text">{feedback.message}</p> : null}

        <div className="stats-grid">
          <StatCard label="Guests" value={overview?.totals.guests ?? 0} hint="Visible in current scope" loading={loading} />
          <StatCard label="Opted in" value={overview?.totals.optedInGuests ?? 0} hint="Marketing consent present" loading={loading} />
          <StatCard label="Repeat visitors" value={overview?.totals.repeatVisitors ?? 0} hint="2+ visits" loading={loading} />
          <StatCard label="Lapsed guests" value={overview?.totals.lapsedGuests ?? 0} hint="90+ days since last visit" loading={loading} />
        </div>

        <div className="marketing-layout">
          <section className="marketing-main">
            {isActiveSection('/') ? (
            <section id="dashboard" className="marketing-page-section">
              {/* Upcoming birthdays — surfaces guests with a birthday in the
                  next 30 days so front-of-house can send a quick gesture. */}
              {(() => {
                const now = new Date();
                const todayMonthDay = (d: Date) => `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
                const compareUpcoming = (a: { birthday: string | null }, b: { birthday: string | null }) => {
                  if (!a.birthday) return 1;
                  if (!b.birthday) return -1;
                  return new Date(a.birthday).getMonth() * 100 + new Date(a.birthday).getDate()
                    - (new Date(b.birthday).getMonth() * 100 + new Date(b.birthday).getDate());
                };
                const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                const monthDayInWindow = (md: string) => {
                  const parts = md.split('-').map(Number);
                  const monthNum = parts[0] ?? 1;
                  const dayNum = parts[1] ?? 1;
                  const candidate = new Date(now.getFullYear(), monthNum - 1, dayNum);
                  if (candidate < now) candidate.setFullYear(candidate.getFullYear() + 1);
                  return candidate <= thirtyDays;
                };
                const upcoming = guests
                  .filter((g) => !!g.birthday)
                  .filter((g) => monthDayInWindow(todayMonthDay(new Date(g.birthday!))))
                  .sort(compareUpcoming)
                  .slice(0, 8);
                if (upcoming.length === 0) return null;
                return (
                  <Card
                    title="Upcoming birthdays"
                    subtitle={`${upcoming.length} guest${upcoming.length === 1 ? '' : 's'} with a birthday in the next 30 days — drop them a line.`}
                  >
                    <div className="birthday-list">
                      {upcoming.map((guest) => {
                        const bday = new Date(guest.birthday!);
                        const dayLabel = bday.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
                        return (
                          <div key={guest.id} className="birthday-row">
                            <div className="birthday-row-main">
                              <strong>{fullName(guest)}</strong>
                              <small>
                                🎂 {dayLabel}
                                {guest.email ? ` · ${guest.email}` : ''}
                                {guest.totalVisits > 0 ? ` · ${guest.totalVisits} visit${guest.totalVisits === 1 ? '' : 's'}` : ''}
                              </small>
                            </div>
                            <div className="birthday-row-actions">
                              {guest.email ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => {
                                    const subject = `Happy birthday from ${guest.venue || 'Alma'}`;
                                    const body = `Hi ${guest.firstName || 'there'},\n\nWishing you a wonderful birthday from all of us at ${guest.venue || 'Alma'}. We'd love to see you for a celebration — let us know when and we'll take care of you.\n\n— The team`;
                                    window.location.href = `mailto:${guest.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                                  }}
                                >
                                  ✉ Email
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => setSelectedGuestIds([guest.id])}
                              >
                                Add to campaign
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              })()}

              <Card title="Recent activity" subtitle={venueParam || 'All venues'}>
              {loading ? <Spinner label="Loading marketing dashboard..." /> : null}
              {!loading && overview ? (
                <div className="marketing-section-grid">
                  <div className="marketing-stack">
                    <div className="marketing-section-heading">
                      <strong>Recent reservations</strong>
                      <Badge tone="neutral">{recentReservations.length}</Badge>
                    </div>
                    {recentReservations.slice(0, 8).map((reservation) => (
                      <div key={reservation.id} className="marketing-summary-card">
                        <strong>{reservation.guestName || fullName(reservation.guest)}</strong>
                        <span>{reservation.venue} · {dateTimeLabel(reservation.startsAt)} · {reservation.status.replace('_', ' ')}</span>
                      </div>
                    ))}
                  </div>
                  <div className="marketing-stack">
                    <div className="marketing-section-heading">
                      <strong>Recent campaigns</strong>
                      <Badge tone="neutral">{campaigns.length}</Badge>
                    </div>
                    {campaigns.slice(0, 6).map((campaign) => (
                      <div key={campaign.id} className="marketing-summary-card">
                        <strong>{campaign.name}</strong>
                        <span>{campaign.channel} · {campaign.status} · {campaign.recipients.length} recipients</span>
                      </div>
                    ))}
                    <div className="marketing-section-heading">
                      <strong>Automations</strong>
                      <Badge tone="neutral">{automations.filter((automation) => automation.active).length} active</Badge>
                    </div>
                    {automations.slice(0, 4).map((automation) => (
                      <div key={automation.id} className="marketing-summary-card">
                        <strong>{automation.name}</strong>
                        <span>{automation.triggerType.replace(/_/g, ' ').toLowerCase()} · {automation.active ? 'active' : 'inactive'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {!loading && overview ? (
                <div className="marketing-section-grid marketing-section-launcher" aria-label="Marketing sections">
                  {MARKETING_NAV_ITEMS.filter((item) => item.href !== '/').map((item) => (
                    <button
                      key={item.href}
                      type="button"
                      className="marketing-summary-card marketing-section-link"
                      onClick={() => navigateMarketingPath(item.href)}
                    >
                      <strong>{item.label}</strong>
                      <span>{item.description}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              </Card>
            </section>
            ) : null}

            {showContentSection ? (
            <section id="content" className="marketing-page-section">
              <Card
                title={
                  showContentAssets
                    ? 'Asset library'
                    : showContentComposer
                      ? 'Post composer'
                      : activePath === '/content/calendar'
                        ? 'Content calendar'
                        : activePath === '/content/approvals'
                          ? 'Content approvals'
                          : 'Content Studio'
                }
                subtitle="Social planning stays in Marketing; platform connection settings live in Admin."
              >
                <div className="stats-grid compact">
                  <StatCard label="Assets" value={contentDashboard?.totals.assets ?? 0} hint={`${contentDashboard?.totals.images ?? 0} images · ${contentDashboard?.totals.videos ?? 0} videos`} loading={loading} />
                  <StatCard label="Drafts" value={contentDashboard?.totals.drafts ?? 0} hint="Ideas and drafts" loading={loading} />
                  <StatCard label="Needs review" value={contentDashboard?.totals.needsReview ?? 0} hint="Approval queue" loading={loading} />
                  <StatCard label="Scheduled" value={contentDashboard?.totals.scheduledPosts ?? 0} hint="On the content calendar" loading={loading} />
                </div>

                <div className="content-section-tabs" aria-label="Content Studio pages">
                  <Button type="button" size="sm" variant={activePath === '/content' ? 'primary' : 'secondary'} onClick={() => navigateMarketingPath('/content')}>Overview</Button>
                  <Button type="button" size="sm" variant={showContentAssets ? 'primary' : 'secondary'} onClick={() => navigateMarketingPath('/content/assets')}>Assets</Button>
                  <Button type="button" size="sm" variant={showContentComposer ? 'primary' : 'secondary'} onClick={() => navigateMarketingPath('/content/composer')}>Composer</Button>
                  <Button type="button" size="sm" variant={activePath === '/content/calendar' ? 'primary' : 'secondary'} onClick={() => navigateMarketingPath('/content/calendar')}>Calendar</Button>
                  <Button type="button" size="sm" variant={activePath === '/content/approvals' ? 'primary' : 'secondary'} onClick={() => navigateMarketingPath('/content/approvals')}>Approvals</Button>
                </div>

                {showContentOverview ? (
                  <div className="marketing-section-grid">
                    <div className="marketing-summary-card">
                      <strong>Plan content in smaller workspaces</strong>
                      <span>Use Assets for uploads, Composer for drafts and previews, Calendar for scheduling, and Approvals for manager review.</span>
                    </div>
                    <div className="marketing-summary-card">
                      <strong>Live publishing setup is admin-owned</strong>
                      <span>{contentDashboard?.totals.setupRequiredAccounts ?? socialAccounts.filter((account) => account.status !== 'CONNECTED').length} Facebook, Instagram, or TikTok account setup item(s) need Admin attention.</span>
                    </div>
                    <div className="marketing-summary-card">
                      <strong>Simulation only</strong>
                      <span>Marketing can preview and simulate social publishing. OAuth, token references, and live publishing readiness are managed in Admin.</span>
                    </div>
                  </div>
                ) : null}

                <div className="content-studio-grid" hidden={!showContentAssets && !showContentComposer}>
                  <div className="marketing-stack" hidden={!showContentAssets}>
                    <Card title="Upload asset" subtitle={contentUploadConfig?.message ?? 'Upload or register images and videos for social posts.'}>
                      <form className="marketing-form" onSubmit={(event) => void saveContentAsset(event)}>
                        <div className="form-grid two">
                          <Select label="Venue" value={contentAssetForm.venue} onChange={(event) => { const el = event.currentTarget; setContentAssetForm((current) => ({ ...current, venue: el.value })); }} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                          <Select label="Type" value={contentAssetForm.assetType} onChange={(event) => { const el = event.currentTarget; setContentAssetForm((current) => ({ ...current, assetType: el.value as MarketingContentAssetType })); }} options={CONTENT_ASSET_TYPES.map((value) => ({ label: value, value }))} />
                          <Input label="Title" required value={contentAssetForm.title} onChange={(event) => { const el = event.currentTarget; setContentAssetForm((current) => ({ ...current, title: el.value })); }} />
                          <Input label="File name" required value={contentAssetForm.fileName} onChange={(event) => { const el = event.currentTarget; setContentAssetForm((current) => ({ ...current, fileName: el.value })); }} />
                          <Input label="MIME type" required value={contentAssetForm.mimeType} onChange={(event) => { const el = event.currentTarget; setContentAssetForm((current) => ({ ...current, mimeType: el.value })); }} />
                          <Input label="File size bytes" type="number" min="0" required value={contentAssetForm.fileSizeBytes} onChange={(event) => { const el = event.currentTarget; setContentAssetForm((current) => ({ ...current, fileSizeBytes: el.value })); }} />
                        </div>
                        <Input label="Public media URL" type="url" required value={contentAssetForm.publicUrl} onChange={(event) => { const el = event.currentTarget; setContentAssetForm((current) => ({ ...current, publicUrl: el.value })); }} placeholder="https://..." />
                        <Input label="Thumbnail URL" type="url" value={contentAssetForm.thumbnailUrl} onChange={(event) => { const el = event.currentTarget; setContentAssetForm((current) => ({ ...current, thumbnailUrl: el.value })); }} placeholder="Optional" />
                        <Input label="Tags" value={contentAssetForm.tags} onChange={(event) => { const el = event.currentTarget; setContentAssetForm((current) => ({ ...current, tags: el.value })); }} placeholder="food, event, margarita" />
                        <Textarea label="Description" rows={2} value={contentAssetForm.description} onChange={(event) => { const el = event.currentTarget; setContentAssetForm((current) => ({ ...current, description: el.value })); }} />
                        <div className="toolbar-right">
                          <ActionFeedback message={feedback.target === 'content-asset' ? feedback.message : null} tone={feedback.tone} />
                          <Button type="submit">Upload asset</Button>
                        </div>
                      </form>
                    </Card>

                    <Card title="Content library" subtitle="Ready assets for posts">
                      {contentAssets.length === 0 ? (
                        <EmptyState title="No assets uploaded" description="Add a public image or video URL to start building post drafts." />
                      ) : (
                        <div className="content-asset-grid">
                          {contentAssets.slice(0, 12).map((asset) => (
                            <article key={asset.id} className="content-asset-card">
                              {asset.thumbnailUrl || asset.publicUrl ? (
                                asset.assetType === 'VIDEO' ? (
                                  <div className="content-asset-thumb video">Video</div>
                                ) : (
                                  <img src={asset.thumbnailUrl || asset.publicUrl || ''} alt={asset.title} />
                                )
                              ) : (
                                <div className="content-asset-thumb">{asset.assetType}</div>
                              )}
                              <strong>{asset.title}</strong>
                              <span>{asset.assetType} · {asset.status} · {asset.venue}</span>
                              <div className="marketing-badges">
                                {asset.tags.slice(0, 3).map((tag) => <Badge key={tag} tone="neutral">{tag}</Badge>)}
                              </div>
                              <div className="marketing-toolbar">
                                <Button type="button" size="sm" variant="secondary" onClick={() => setContentPostForm((current) => ({ ...current, assetId: asset.id }))}>Attach to draft</Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => void archiveContentAsset(asset.id)}>Archive</Button>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </Card>
                  </div>

                  <div className="marketing-stack" hidden={!showContentComposer}>
                    <Card title="Post composer" subtitle="Facebook, Instagram, and TikTok previews. Live publish stays setup required.">
                      <div className="ai-helper-panel" role="region" aria-label="AI content helpers">
                        <div className="ai-helper-panel-head">
                          <div>
                            <span className="ai-helper-eyebrow">✨ AI assist</span>
                            <strong>Generate post or campaign copy in seconds</strong>
                            <small>Tap a brief to prefill the composer below, or generate a draft directly.</small>
                          </div>
                        </div>
                        <div className="ai-helper-grid">
                          {contentHelpers.map((helper) => (
                            <div key={helper.id} className="ai-helper-card">
                              <strong>{helper.label}</strong>
                              {helper.campaignSubject ? <small>{helper.campaignSubject}</small> : null}
                              <div className="ai-helper-actions">
                                <Button type="button" size="sm" variant="secondary" onClick={() => applyContentHelper(helper)}>
                                  Prefill
                                </Button>
                                <Button type="button" size="sm" onClick={() => void createPostFromHelper(helper)}>
                                  Create draft →
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <ActionFeedback message={feedback.target === 'content-helper' ? feedback.message : null} tone={feedback.tone} />
                      </div>
                      <form className="marketing-form" onSubmit={(event) => void saveContentPost(event)}>
                        <div className="form-grid two">
                          <Select label="Venue" value={contentPostForm.venue} onChange={(event) => { const el = event.currentTarget; setContentPostForm((current) => ({ ...current, venue: el.value })); }} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                          <Select label="Pillar" value={contentPostForm.contentPillar} onChange={(event) => { const el = event.currentTarget; setContentPostForm((current) => ({ ...current, contentPillar: el.value })); }} options={CONTENT_PILLARS.map((value) => ({ label: prettyLabel(value), value }))} />
                          <Input label="Title" required value={contentPostForm.title} onChange={(event) => { const el = event.currentTarget; setContentPostForm((current) => ({ ...current, title: el.value })); }} />
                          <Input label="Schedule" type="datetime-local" min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} value={contentPostForm.scheduledAt} onChange={(event) => { const el = event.currentTarget; setContentPostForm((current) => ({ ...current, scheduledAt: el.value })); }} />
                        </div>
                        <Textarea label="Caption" rows={5} required value={contentPostForm.caption} onChange={(event) => { const el = event.currentTarget; setContentPostForm((current) => ({ ...current, caption: el.value })); }} />
                        <Select label="Attach asset" value={contentPostForm.assetId} onChange={(event) => { const el = event.currentTarget; setContentPostForm((current) => ({ ...current, assetId: el.value })); }} options={[{ label: 'No asset attached', value: '' }, ...contentAssets.map((asset) => ({ label: `${asset.title} · ${asset.assetType}`, value: asset.id }))]} />
                        <div className="marketing-consent-row">
                          {SOCIAL_PLATFORMS.map((platform) => (
                            <label key={platform}>
                              <input type="checkbox" checked={contentPostForm.targetChannels.includes(platform)} onChange={() => toggleContentChannel(platform)} /> {platform}
                            </label>
                          ))}
                        </div>
                        <div className="content-preview-tabs">
                          {contentPostForm.targetChannels.map((platform) => {
                            const hasAsset = Boolean(contentPostForm.assetId);
                            const selectedAsset = contentAssets.find((asset) => asset.id === contentPostForm.assetId);
                            const warning =
                              platform === 'TIKTOK' && selectedAsset?.assetType !== 'VIDEO'
                                ? 'TikTok needs a video asset.'
                                : platform === 'INSTAGRAM' && !hasAsset
                                  ? 'Instagram needs an image or video asset.'
                                  : 'Ready to simulate; live publish setup required.';
                            return (
                              <div key={platform} className="content-channel-preview">
                                <strong>{platform}</strong>
                                <p>{contentPostForm.caption || 'Write a caption to preview this post.'}</p>
                                <span>{warning}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="toolbar-right">
                          <ActionFeedback message={feedback.target === 'content-post' ? feedback.message : null} tone={feedback.tone} />
                          <Button type="submit">Save draft</Button>
                        </div>
                      </form>
                    </Card>

                    <Card title="Drafts and scheduled posts" subtitle="Submit, approve, schedule, preview, and simulate">
                      {contentPosts.length === 0 ? (
                        <EmptyState title="No post drafts" description="Create a draft and attach a library asset to start the content calendar." />
                      ) : (
                        <div className="marketing-stack">
                          {contentPosts.slice(0, 10).map((post) => {
                            const liveState = livePublishStateForPost(post, contentPublishPreview);
                            return (
                              <article key={post.id} className="content-post-card">
                                  <div>
                                    <strong>{post.title}</strong>
                                    <span>{post.venue} · {post.status} · {post.targetChannels.join(', ')}</span>
                                    <p>{post.caption}</p>
                                  </div>
                                  <div className="marketing-badges">
                                    {post.contentPillar ? <Badge tone="neutral">{prettyLabel(post.contentPillar)}</Badge> : null}
                                    {post.scheduledAt ? <Badge tone="positive">{dateTimeLabel(post.scheduledAt)}</Badge> : <Badge tone="warning">Unscheduled</Badge>}
                                    {post.campaignId ? <Badge tone="info">Linked campaign</Badge> : null}
                                  </div>
                                  <div className="marketing-toolbar">
                                    <Button type="button" size="sm" variant="secondary" onClick={() => void submitContentPost(post.id)}>Submit review</Button>
                                    <Button type="button" size="sm" variant="secondary" onClick={() => void approveContentPost(post.id)}>Approve</Button>
                                    <Button type="button" size="sm" variant="secondary" onClick={() => void scheduleContentPost(post.id, post.scheduledAt)}>Schedule</Button>
                                    <Button type="button" size="sm" variant="secondary" onClick={() => void previewContentPostPublish(post.id)}>Preview</Button>
                                    <Button type="button" size="sm" variant="secondary" onClick={() => void createCampaignFromPost(post.id)}>Create email campaign</Button>
                                    <Button type="button" size="sm" onClick={() => void simulateContentPostPublish(post.id)}>Simulate</Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={liveState.ready ? 'primary' : 'ghost'}
                                      disabled={!liveState.ready}
                                      title={liveState.title}
                                      onClick={() => void publishContentPostLive(post.id)}
                                    >
                                      {liveState.label}
                                    </Button>
                                  </div>
                                  <ActionFeedback
                                    message={
                                      feedback.target === `content-post:${post.id}` || feedback.target === `content-preview:${post.id}`
                                        ? feedback.message
                                        : null
                                    }
                                    tone={feedback.tone}
                                  />
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </Card>
                  </div>
                </div>

                <div className="content-bottom-grid" hidden={!showContentCalendar && !showContentApprovals}>
                  {showContentCalendar ? (
                    <Card
                      title="Content calendar"
                      subtitle="Scheduled and approved social posts"
                      action={
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => navigateMarketingPath('/content/composer')}
                        >
                          ✨ AI assist
                        </Button>
                      }
                    >
                      {upcomingContentPosts.length === 0 ? (
                        <EmptyState
                          title="No scheduled content"
                          description="Save a post with a schedule time, then approve and simulate it. Or tap ✨ AI assist to generate a draft from a hospitality brief."
                        />
                      ) : (
                        <div className="content-calendar-list">
                          {upcomingContentPosts.map((post) => (
                            <div key={post.id} className="content-calendar-row">
                              <time>{post.scheduledAt ? shortDate(post.scheduledAt) : 'No date'}</time>
                              <span>
                                <strong>{post.title}</strong>
                                {post.venue} · {post.status} · {post.targetChannels.join(', ')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  ) : null}

                  {showContentApprovals ? (
                    <Card title="Approvals" subtitle="Posts waiting for manager review">
                      {postsNeedingReview.length === 0 ? (
                        <EmptyState title="Approval queue clear" description="Submitted posts will appear here for review before scheduling." />
                      ) : (
                        <div className="marketing-stack">
                          {postsNeedingReview.map((post) => (
                            <div key={post.id} className="marketing-summary-card">
                              <strong>{post.title}</strong>
                              <span>{post.venue} · {post.targetChannels.join(', ')}</span>
                              <Button type="button" size="sm" onClick={() => void approveContentPost(post.id)}>Approve post</Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  ) : null}
                </div>

                {showContentPerformance ? <MarketingEngagementSection venue={venueFilter} /> : null}

                {showContentComposer && contentPublishPreview ? (
                  <Card title="Platform publish preview" subtitle={contentPublishPreview.message ?? contentPublishPreview.post.title}>
                    <div className="content-preview-tabs">
                      {contentPublishPreview.previews.map((preview) => (
                        <div key={preview.platform} className="content-channel-preview">
                          <strong>{preview.platform}</strong>
                          <Badge tone={preview.status === 'READY_TO_SIMULATE' ? 'positive' : 'warning'}>{prettyLabel(preview.status)}</Badge>
                          <p>{preview.message}</p>
                          <small>{JSON.stringify((preview.requestPreview as { livePublish?: unknown }).livePublish ?? preview.requestPreview).slice(0, 240)}</small>
                        </div>
                      ))}
                    </div>
                    {contentPublishPreview.attempts ? (
                      <div className="marketing-badges">
                        {contentPublishPreview.attempts.map((attempt) => (
                          <Badge key={attempt.id} tone={attempt.status === 'SIMULATED' || attempt.status === 'PUBLISHED' ? 'positive' : 'warning'}>
                            {attempt.platform}: {attempt.status}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                ) : null}
              </Card>
            </section>
            ) : null}

            {isActiveSection('/guests') ? (
            <section id="guests" className="marketing-page-section">
              <Card title="Guest CRM" subtitle="Profiles, consent status, tags, and visit history">
              <div className="marketing-section-grid">
                <div className="marketing-stack">
                  {guests.length === 0 ? (
                    <EmptyState title="No guests yet" description="Reserve bookings will start populating the guest book automatically." />
                  ) : (
                    guests.map((guest) => (
                      <article key={guest.id} className="marketing-contact">
                        <label className="marketing-checkbox">
                          <input type="checkbox" checked={selectedGuestIds.includes(guest.id)} onChange={() => toggleGuestSelection(guest.id)} />
                          <span>
                            <strong>{fullName(guest)}</strong>
                            <small>{guest.email || guest.phone || 'No contact'} · {guest.venue || 'Cross-venue'} · {guest.totalVisits} visits</small>
                          </span>
                        </label>
                        <div className="marketing-badges">
                          {guest.marketingOptIn ? <Badge tone="positive">Opted in</Badge> : <Badge tone="neutral">No consent</Badge>}
                          {guest.tagAssignments?.slice(0, 3).map((assignment) => (
                            <Badge key={assignment.id} tone="neutral">{assignment.tag.name}</Badge>
                          ))}
                          <Button type="button" size="sm" variant="secondary" onClick={() => setSelectedGuestId(guest.id)}>Open</Button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
                <div className="marketing-stack">
                  {guestDetail ? (
                    <>
                      <Card title={fullName(guestDetail.guest)} subtitle={guestDetail.guest.venue || 'Venue not set'}>
                        <div className="marketing-summary-list">
                          <span>{guestDetail.guest.email || 'No email'}</span>
                          <span>{guestDetail.guest.phone || 'No phone'}</span>
                          <span>{guestDetail.guest.marketingOptIn ? 'Opted into marketing' : 'No marketing consent'}</span>
                          <span>{guestDetail.guest.totalVisits} visits · ${(
                            guestDetail.guest.totalSpendCents / 100
                          ).toFixed(2)} tracked spend</span>
                        </div>
                        <div className="marketing-badges">
                          {guestDetail.guest.tagAssignments?.map((assignment) => (
                            <span key={assignment.id} className="marketing-tag-chip">
                              <Badge tone="neutral">{assignment.tag.name}</Badge>
                              {assignment.source === 'MANUAL' ? (
                                <button type="button" onClick={() => void removeTag(guestDetail.guest.id, assignment.tagId)}>×</button>
                              ) : null}
                            </span>
                          ))}
                        </div>
                        <div className="marketing-toolbar">
                          <Select
                            label="Add manual tag"
                            value=""
                            onChange={(event) => {
                              if (!event.currentTarget.value) return;
                              void assignTag(guestDetail.guest.id, event.currentTarget.value);
                            }}
                            options={[{ label: 'Choose tag', value: '' }, ...tags.map((tag) => ({ label: `${tag.name}${tag.venue ? ` · ${tag.venue}` : ''}`, value: tag.id }))]}
                          />
                          <Button type="button" variant="secondary" onClick={() => void recalculateTags(guestDetail.guest.id)}>Recalculate auto-tags</Button>
                        </div>
                        <ActionFeedback message={feedback.target === 'guest-tag' || feedback.target === 'auto-tags' ? feedback.message : null} tone={feedback.tone} />
                      </Card>
                      <Card title="Reservation history" subtitle={`${guestDetail.reservations.length} bookings`}>
                        {guestDetail.reservations.length === 0 ? (
                          <EmptyState title="No bookings yet" description="This guest will build behavioural history through Reserve reservations." />
                        ) : (
                          <div className="marketing-stack">
                            {guestDetail.reservations.slice(0, 8).map((reservation) => (
                              <div key={reservation.id} className="marketing-summary-card">
                                <strong>{reservation.status.replace('_', ' ')}</strong>
                                <span>{dateTimeLabel(reservation.startsAt)} · {reservation.covers} guests · {reservation.venue}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </Card>
                      <Card title="Guest timeline" subtitle="Reservations, tags, campaign simulations, content links, and gift card matches">
                        {guestDetail.timeline?.timeline.length ? (
                          <div className="marketing-stack">
                            {guestDetail.timeline.timeline.slice(0, 12).map((item) => (
                              <div key={item.id} className="marketing-summary-card">
                                <strong>{item.title}</strong>
                                <span>{dateTimeLabel(item.at)} · {item.source.replace('_', ' ')} · {item.venue || 'No venue'}</span>
                                <span>{item.description}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <EmptyState title="No timeline yet" description="Reservations, tags, campaign simulations, and gift card matches will appear here." />
                        )}
                      </Card>
                    </>
                  ) : (
                    <EmptyState title="Select a guest" description="Review consent, manual tags, and visit history from one panel." />
                  )}
                </div>
              </div>
              </Card>
            </section>
            ) : null}

            {isActiveSection('/segments') ? (
            <section id="segments" className="marketing-page-section">
              <Card title="Tags and segments" subtitle="Manual tags plus automatic audience rules">
              <div className="marketing-section-grid">
                <div className="marketing-stack">
                  <Card title="Create tag" subtitle="Manual tags stay separate from automatic recalculation">
                    <form className="marketing-form" onSubmit={(event) => void saveTag(event)}>
                      <div className="form-grid two">
                        <Select label="Venue" value={tagForm.venue} onChange={(event) => { const el = event.currentTarget; setTagForm((current) => ({ ...current, venue: el.value })); }} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                        <Select label="Type" value={tagForm.type} onChange={(event) => { const el = event.currentTarget; setTagForm((current) => ({ ...current, type: el.value as GuestTagType })); }} options={TAG_TYPES.map((value) => ({ label: value, value }))} />
                        <Input label="Tag name" required value={tagForm.name} onChange={(event) => { const el = event.currentTarget; setTagForm((current) => ({ ...current, name: el.value })); }} />
                        <Input label="Colour" type="color" value={tagForm.color} onChange={(event) => { const el = event.currentTarget; setTagForm((current) => ({ ...current, color: el.value })); }} />
                      </div>
                      <Textarea label="Description" rows={2} value={tagForm.description} onChange={(event) => { const el = event.currentTarget; setTagForm((current) => ({ ...current, description: el.value })); }} />
                      <div className="toolbar-right">
                        <ActionFeedback message={feedback.target === 'tag' ? feedback.message : null} tone={feedback.tone} />
                        <Button type="submit">Save tag</Button>
                      </div>
                    </form>
                  </Card>

                  <Card title="Current tags" subtitle={`${tags.length} tags in scope`}>
                    <div className="marketing-badges">
                      {tags.map((tag) => (
                        <Badge key={tag.id} tone={tag.type === 'AUTOMATIC' ? 'warning' : tag.type === 'SYSTEM' ? 'neutral' : 'positive'}>
                          {tag.name}
                        </Badge>
                      ))}
                    </div>
                    <div className="toolbar-right">
                      <ActionFeedback message={feedback.target === 'auto-tags' ? feedback.message : null} tone={feedback.tone} />
                      <Button type="button" variant="secondary" onClick={() => void recalculateTags()}>
                        Recalculate venue auto-tags
                      </Button>
                    </div>
                  </Card>
                </div>

                <div className="marketing-stack">
                  <Card title="Segment preview" subtitle="No external send. Preview who qualifies and who gets skipped.">
                    <form className="marketing-form" onSubmit={(event) => void previewSegment(event)}>
                      <div className="form-grid two">
                        <Select label="Venue" value={segmentForm.venue} onChange={(event) => { const el = event.currentTarget; setSegmentForm((current) => ({ ...current, venue: el.value })); }} options={options.filter((option) => option.value !== ALL_VENUES)} />
                        <Select label="Channel" value={segmentForm.channel} onChange={(event) => { const el = event.currentTarget; setSegmentForm((current) => ({ ...current, channel: el.value as MarketingChannel })); }} options={CAMPAIGN_CHANNELS.map((value) => ({ label: value, value }))} />
                        <Input label="Search filter" value={segmentForm.search} onChange={(event) => { const el = event.currentTarget; setSegmentForm((current) => ({ ...current, search: el.value })); }} />
                        <Select label="Must have tag" value={segmentForm.tagId} onChange={(event) => { const el = event.currentTarget; setSegmentForm((current) => ({ ...current, tagId: el.value })); }} options={[{ label: 'Any tag state', value: '' }, ...tags.map((tag) => ({ label: tag.name, value: tag.id }))]} />
                        <Select label="Exclude tag" value={segmentForm.excludedTagId} onChange={(event) => { const el = event.currentTarget; setSegmentForm((current) => ({ ...current, excludedTagId: el.value })); }} options={[{ label: 'No excluded tag', value: '' }, ...tags.map((tag) => ({ label: tag.name, value: tag.id }))]} />
                        <Input label="Minimum visits" type="number" min="0" value={segmentForm.minVisits} onChange={(event) => { const el = event.currentTarget; setSegmentForm((current) => ({ ...current, minVisits: el.value })); }} />
                        <Input label="Maximum visits" type="number" min="0" value={segmentForm.maxVisits} onChange={(event) => { const el = event.currentTarget; setSegmentForm((current) => ({ ...current, maxVisits: el.value })); }} />
                        <Input label="Last visit older than days" type="number" min="0" value={segmentForm.maxDaysSinceVisit} onChange={(event) => { const el = event.currentTarget; setSegmentForm((current) => ({ ...current, maxDaysSinceVisit: el.value })); }} />
                        <Input label="Last visit within days" type="number" min="0" value={segmentForm.lastVisitWithinDays} onChange={(event) => { const el = event.currentTarget; setSegmentForm((current) => ({ ...current, lastVisitWithinDays: el.value })); }} />
                        <Input label="Birthday within days" type="number" min="1" value={segmentForm.birthdaysWithinDays} onChange={(event) => { const el = event.currentTarget; setSegmentForm((current) => ({ ...current, birthdaysWithinDays: el.value })); }} />
                        <Input label="Minimum spend cents" type="number" min="0" value={segmentForm.minSpendCents} onChange={(event) => { const el = event.currentTarget; setSegmentForm((current) => ({ ...current, minSpendCents: el.value })); }} />
                      </div>
                      <div className="marketing-consent-row">
                        <label><input type="checkbox" checked={segmentForm.marketingOptInOnly} onChange={(event) => { const checked = event.currentTarget.checked; setSegmentForm((current) => ({ ...current, marketingOptInOnly: checked })); }} /> Consent required</label>
                        <label><input type="checkbox" checked={segmentForm.emailOnly} onChange={(event) => { const checked = event.currentTarget.checked; setSegmentForm((current) => ({ ...current, emailOnly: checked })); }} /> Email required</label>
                        <label><input type="checkbox" checked={segmentForm.includeUnsubscribed} onChange={(event) => { const checked = event.currentTarget.checked; setSegmentForm((current) => ({ ...current, includeUnsubscribed: checked })); }} /> Include unsubscribed</label>
                        <label><input type="checkbox" checked={segmentForm.hasUpcomingReservation} onChange={(event) => { const checked = event.currentTarget.checked; setSegmentForm((current) => ({ ...current, hasUpcomingReservation: checked })); }} /> Has upcoming booking</label>
                        <label><input type="checkbox" checked={segmentForm.hasGiftCardPurchase} onChange={(event) => { const checked = event.currentTarget.checked; setSegmentForm((current) => ({ ...current, hasGiftCardPurchase: checked })); }} /> Has gift card order</label>
                      </div>
                      <div className="toolbar-right">
                        <ActionFeedback message={feedback.target === 'segment' ? feedback.message : null} tone={feedback.tone} />
                        <Button type="submit" disabled={isLoadingSegmentPreview}>Preview segment</Button>
                      </div>
                    </form>
                    {isLoadingSegmentPreview ? <Spinner label="Previewing segment..." /> : null}
                    {segmentPreview ? (
                      <div className="marketing-stack">
                        <div className="marketing-summary-card">
                          <strong>{segmentPreview.includedCount} included</strong>
                          <span>{segmentPreview.skippedCount} skipped · {segmentPreview.guestCount} total · {segmentPreview.estimatedReachableEmailCount} reachable email</span>
                        </div>
                        <div className="toolbar-right">
                          <Button
                            type="button"
                            onClick={() => {
                              setCampaignForm((current) => ({
                                ...current,
                                venue: segmentForm.venue,
                                channel: segmentForm.channel,
                                audienceName: current.audienceName ||
                                  `${segmentPreview.includedCount} guests · ${segmentForm.venue}`
                              }));
                              navigateMarketingPath('/campaigns');
                            }}
                            disabled={segmentPreview.includedCount === 0}
                          >
                            Send campaign to this segment →
                          </Button>
                          <span className="subtle" style={{ fontSize: 12 }}>
                            Pre-fills the campaign builder with this segment attached
                          </span>
                        </div>
                        <div className="marketing-badges">
                          {Object.entries(segmentPreview.skippedReasons).map(([reason, count]) => (
                            <Badge key={reason} tone="warning">{reason}: {count}</Badge>
                          ))}
                        </div>
                        {segmentPreview.guests.slice(0, 6).map((guest) => (
                          <div key={guest.id} className="marketing-summary-card">
                            <strong>{fullName(guest)}</strong>
                            <span>{guest.email || 'No email'} · {guest.totalVisits} visits · {guest.venue || 'No venue'}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                </div>
              </div>
              </Card>
            </section>
            ) : null}
          </section>

          <aside className="marketing-side">
            {isActiveSection('/templates') ? (
            <section id="templates" className="marketing-page-section">
              <Card title="Templates" subtitle="HTML accepted. Preview rendered inside a sandboxed iframe.">
              <form className="marketing-form" onSubmit={(event) => void saveTemplate(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={templateForm.venue} onChange={(event) => { const el = event.currentTarget; setTemplateForm((current) => ({ ...current, venue: el.value })); }} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                  <Select label="Status" value={templateForm.status} onChange={(event) => { const el = event.currentTarget; setTemplateForm((current) => ({ ...current, status: el.value as TemplateForm['status'] })); }} options={TEMPLATE_STATUSES.map((value) => ({ label: value, value }))} />
                  <Input label="Template name" required value={templateForm.name} onChange={(event) => { const el = event.currentTarget; setTemplateForm((current) => ({ ...current, name: el.value })); }} />
                  <Input label="Subject" required value={templateForm.subject} onChange={(event) => { const el = event.currentTarget; setTemplateForm((current) => ({ ...current, subject: el.value })); }} />
                </div>
                <Input label="Preview text" value={templateForm.previewText} onChange={(event) => { const el = event.currentTarget; setTemplateForm((current) => ({ ...current, previewText: el.value })); }} />
                <Textarea label="HTML body" rows={8} value={templateForm.htmlBody} onChange={(event) => { const el = event.currentTarget; setTemplateForm((current) => ({ ...current, htmlBody: el.value })); }} />
                <Textarea label="Text body" rows={4} value={templateForm.textBody} onChange={(event) => { const el = event.currentTarget; setTemplateForm((current) => ({ ...current, textBody: el.value })); }} />
                <div className="toolbar-right">
                  <ActionFeedback message={feedback.target === 'template' ? feedback.message : null} tone={feedback.tone} />
                  <Button type="submit">Save template</Button>
                </div>
              </form>
              <iframe
                className="marketing-preview-frame"
                sandbox=""
                srcDoc={htmlPreviewDocument(templateForm.subject, templateForm.previewText, templateForm.htmlBody, previewContext)}
                title="Template preview"
              />
              <div className="marketing-summary-list">
                {templates.slice(0, 4).map((template) => (
                  <span key={template.id}>{template.name} · {template.venue || 'Global'} · {template.status}</span>
                ))}
              </div>
              </Card>
            </section>
            ) : null}

            {isActiveSection('/campaigns') ? (
            <section id="campaigns" className="marketing-page-section">
              <Card title="Campaigns" subtitle="Recipient preview and simulation only. No external send.">
              <form className="marketing-form" onSubmit={(event) => void saveCampaign(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={campaignForm.venue} onChange={(event) => { const el = event.currentTarget; setCampaignForm((current) => ({ ...current, venue: el.value })); }} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                  <Select label="Channel" value={campaignForm.channel} onChange={(event) => { const el = event.currentTarget; setCampaignForm((current) => ({ ...current, channel: el.value as MarketingChannel })); }} options={CAMPAIGN_CHANNELS.map((value) => ({ label: value, value }))} />
                  <Input label="Campaign name" required value={campaignForm.name} onChange={(event) => { const el = event.currentTarget; setCampaignForm((current) => ({ ...current, name: el.value })); }} />
                  <Input label="Audience name" value={campaignForm.audienceName} onChange={(event) => { const el = event.currentTarget; setCampaignForm((current) => ({ ...current, audienceName: el.value })); }} />
                  <Input label="Subject" value={campaignForm.subject} onChange={(event) => { const el = event.currentTarget; setCampaignForm((current) => ({ ...current, subject: el.value })); }} />
                  <Input label="Preview text" value={campaignForm.previewText} onChange={(event) => { const el = event.currentTarget; setCampaignForm((current) => ({ ...current, previewText: el.value })); }} />
                </div>
                <Textarea label="HTML body" rows={6} value={campaignForm.body} onChange={(event) => { const el = event.currentTarget; setCampaignForm((current) => ({ ...current, body: el.value })); }} />
                <Textarea label="Text body" rows={3} value={campaignForm.textBody} onChange={(event) => { const el = event.currentTarget; setCampaignForm((current) => ({ ...current, textBody: el.value })); }} />
                <p className="subtle">{selectedGuestIds.length} manually selected guests will be merged with the current segment rules.</p>
                <div className="toolbar-right">
                  <ActionFeedback message={feedback.target === 'campaign' ? feedback.message : null} tone={feedback.tone} />
                  <Button type="submit">Save draft</Button>
                </div>
              </form>
              <iframe
                className="marketing-preview-frame"
                sandbox=""
                srcDoc={htmlPreviewDocument(campaignForm.subject, campaignForm.previewText, campaignForm.body, previewContext)}
                title="Campaign preview"
              />
              <div className="marketing-stack">
                {campaigns.slice(0, 5).map((campaign) => (
                  <div key={campaign.id} className="marketing-summary-card">
                    {(() => {
                      const linkedPosts = contentPosts.filter((post) => post.campaignId === campaign.id);
                      return linkedPosts.length ? (
                        <span className="subtle">{linkedPosts.length} linked social post{linkedPosts.length === 1 ? '' : 's'}</span>
                      ) : null;
                    })()}
                    <strong>{campaign.name}</strong>
                    <span>{campaign.channel} · {campaign.status} · {campaign.recipients.length} recipients</span>
                    {!campaign.simulatedAt && !campaign.sentAt ? (
                      <div className="marketing-badges">
                        <Badge tone="warning">Needs test send</Badge>
                      </div>
                    ) : null}
                    <div className="marketing-badges">
                      <Button type="button" size="sm" variant="secondary" onClick={() => void previewCampaignRecipients(campaign.id)} disabled={loadingCampaignId === campaign.id}>Preview</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => void createContentPostFromCampaign(campaign.id)}>Create social post</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => void issueGiftCardsForCampaign(campaign.id)}>🎁 Issue gift cards</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => void simulateCampaign(campaign.id)} disabled={loadingCampaignId === campaign.id}>Simulate send</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => void testSendCampaign(campaign.id)} disabled={loadingCampaignId === campaign.id}>📧 Test send</Button>
                      <Button type="button" size="sm" onClick={() => void liveSendCampaign(campaign)} disabled={loadingCampaignId === campaign.id || !campaign.simulatedAt || Boolean(campaign.sentAt)}>
                        {campaign.sentAt ? 'Sent ✓' : 'Send live'}
                      </Button>
                    </div>
                    <ActionFeedback
                      message={
                        feedback.target === `campaign-preview:${campaign.id}` || feedback.target === `campaign-simulate:${campaign.id}`
                          ? feedback.message
                          : null
                      }
                      tone={feedback.tone}
                    />
                  </div>
                ))}
              </div>
              {campaignPreview ? (
                <Card title="Campaign preview result" subtitle={`${campaignPreview.includedCount} included · ${campaignPreview.skippedCount} skipped`}>
                  {campaignPreview.message ? <p className="subtle">{campaignPreview.message}</p> : null}
                  <p className="subtle">{campaignPreview.estimatedReachableEmailCount} guests have reachable email for this audience.</p>
                  <div className="marketing-badges">
                    {Object.entries(campaignPreview.skippedReasons).map(([reason, count]) => (
                      <Badge key={reason} tone="warning">{reason}: {count}</Badge>
                    ))}
                  </div>
                </Card>
              ) : null}
              </Card>
            </section>
            ) : null}

            {isActiveSection('/automations') ? (
            <section id="automations" className="marketing-page-section">
              <Card
                title="Automations"
                subtitle="Trigger-based emails that send automatically. Install the starter library to get the visit-lifecycle set in one click."
                action={<Button type="button" variant="secondary" onClick={() => void installStarterAutomations()}>Install starter automations</Button>}
              >
              <form className="marketing-form" onSubmit={(event) => void saveAutomation(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={automationForm.venue} onChange={(event) => { const el = event.currentTarget; setAutomationForm((current) => ({ ...current, venue: el.value })); }} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                  <Select label="Trigger" value={automationForm.triggerType} onChange={(event) => { const el = event.currentTarget; setAutomationForm((current) => ({ ...current, triggerType: el.value as MarketingAutomationTriggerType })); }} options={AUTOMATION_TRIGGERS.map((value) => ({ label: value.replace(/_/g, ' '), value }))} />
                  <Input label="Automation name" required value={automationForm.name} onChange={(event) => { const el = event.currentTarget; setAutomationForm((current) => ({ ...current, name: el.value })); }} />
                  <Select label="Email template" value={automationForm.emailTemplateId} onChange={(event) => { const el = event.currentTarget; setAutomationForm((current) => ({ ...current, emailTemplateId: el.value })); }} options={[{ label: 'No template yet', value: '' }, ...templates.map((template) => ({ label: `${template.name} · ${template.venue || 'Global'}`, value: template.id }))]} />
                  <Input label="Delay hours" type="number" min="0" value={automationForm.delayHours} onChange={(event) => { const el = event.currentTarget; setAutomationForm((current) => ({ ...current, delayHours: el.value })); }} />
                </div>
                <label className="marketing-consent-row">
                  <label><input type="checkbox" checked={automationForm.active} onChange={(event) => { const checked = event.currentTarget.checked; setAutomationForm((current) => ({ ...current, active: checked })); }} /> Active after review</label>
                </label>
                <div className="toolbar-right">
                  <ActionFeedback message={feedback.target === 'automation' ? feedback.message : null} tone={feedback.tone} />
                  <Button type="submit">Save automation</Button>
                </div>
              </form>
              {selectedTemplate ? (
                <iframe
                  className="marketing-preview-frame"
                  sandbox=""
                  srcDoc={htmlPreviewDocument(selectedTemplate.subject, selectedTemplate.previewText ?? '', selectedTemplate.htmlBody, previewContext)}
                  title="Automation template preview"
                />
              ) : null}
              <div className="marketing-stack">
                {automations.length === 0 ? (
                  <EmptyState title="No automations yet" description="Create an automation to trigger messages based on guest events." />
                ) : null}
                {automations.slice(0, 5).map((automation) => {
                  const metric = automationMetrics.find((m) => m.automationId === automation.id);
                  const lastRunRelative = metric?.lastRunAt
                    ? (() => {
                        const diff = Date.now() - new Date(metric.lastRunAt).getTime();
                        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                        if (days === 0) return 'today';
                        if (days === 1) return 'yesterday';
                        if (days < 30) return `${days}d ago`;
                        return `${Math.floor(days / 30)}mo ago`;
                      })()
                    : null;
                  return (
                    <div key={automation.id} className="marketing-summary-card">
                      <strong>{automation.name}</strong>
                      <span>{automation.triggerType.replace(/_/g, ' ').toLowerCase()} · {automation.active ? 'active' : 'inactive'} · delay {automation.delayHours}h</span>
                      {metric && metric.totalRuns > 0 ? (
                        <div className="automation-metrics">
                          <div className="automation-metric">
                            <strong>{metric.totalRuns}</strong>
                            <span>guests reached</span>
                          </div>
                          {metric.simulatedCount > 0 ? (
                            <div className="automation-metric">
                              <strong>{metric.simulatedCount}</strong>
                              <span>simulated</span>
                            </div>
                          ) : null}
                          {metric.sentCount > 0 ? (
                            <div className="automation-metric is-positive">
                              <strong>{metric.sentCount}</strong>
                              <span>sent</span>
                            </div>
                          ) : null}
                          {metric.skippedCount > 0 ? (
                            <div className="automation-metric is-warning">
                              <strong>{metric.skippedCount}</strong>
                              <span>skipped</span>
                            </div>
                          ) : null}
                          {lastRunRelative ? (
                            <div className="automation-metric">
                              <strong>{lastRunRelative}</strong>
                              <span>last run</span>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="subtle" style={{ margin: 0, fontSize: 12 }}>
                          No runs yet. Click Simulate to see how many guests qualify.
                        </p>
                      )}
                      <div className="marketing-badges">
                        <Button type="button" size="sm" variant="secondary" onClick={() => void simulateAutomation(automation.id)}>Simulate</Button>
                      </div>
                      <ActionFeedback message={feedback.target === `automation:${automation.id}` ? feedback.message : null} tone={feedback.tone} />
                    </div>
                  );
                })}
              </div>
              </Card>
            </section>
            ) : null}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

// Phase 4.7 — Marketing engagement read-back. Fetches the social engagement
// payload from /api/marketing/social/engagement which returns either real
// numbers (once Meta tokens are wired) or simulated metrics marked clearly.
type EngagementPostRow = {
  postId: string;
  title: string;
  caption: string;
  venue: string;
  publishedAt: string | null;
  platform: 'INSTAGRAM' | 'FACEBOOK' | 'TIKTOK' | 'OTHER';
  externalPostId: string | null;
  metrics: {
    reach: number | null;
    impressions: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
  };
  engagementRate: number | null;
  simulated: boolean;
};
type EngagementPayload = {
  generatedAt: string;
  mode: 'LIVE' | 'SIMULATED' | 'SETUP_REQUIRED';
  setup: { missingEnvVars: string[]; connectedAccounts: number; publishedPosts: number; note: string };
  totals: { publishedPosts: number; reach: number; likes: number; comments: number };
  topPosts: EngagementPostRow[];
};

function MarketingEngagementSection({ venue }: { venue: string }) {
  const [payload, setPayload] = useState<EngagementPayload | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ days: String(days) });
    if (venue) params.set('venue', venue);
    api<EngagementPayload>(`/api/marketing/social/engagement?${params.toString()}`)
      .then((data) => { if (!cancelled) setPayload(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load engagement'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [venue, days]);

  const isSimulated = payload?.mode === 'SIMULATED';
  const isSetup = payload?.mode === 'SETUP_REQUIRED';

  return (
    <section id="content-performance" className="marketing-page-section">
      <Card title="Social post performance" subtitle="Reach, likes, comments and saves for posts you've published.">
        {loading ? <Spinner label="Loading engagement" /> : null}
        {error ? <p className="comms-error">{error}</p> : null}

        {payload && (isSimulated || isSetup) ? (
          <div className="alma-preview-banner" role="status" style={{ marginBottom: 12 }}>
            <strong>{isSetup ? 'Setup required' : 'Simulated data'}</strong>
            <span>{payload.setup.note}</span>
            {payload.setup.missingEnvVars.length ? (
              <small>Pending: {payload.setup.missingEnvVars.join(', ')}</small>
            ) : null}
          </div>
        ) : null}

        {payload ? (
          <>
            <div className="form-grid" style={{ marginBottom: 14 }}>
              <Select
                label="Window"
                value={String(days)}
                onChange={(event) => setDays(Number(event.currentTarget.value))}
                options={[
                  { label: 'Last 7 days', value: '7' },
                  { label: 'Last 30 days', value: '30' },
                  { label: 'Last 60 days', value: '60' },
                  { label: 'Last 90 days', value: '90' }
                ]}
              />
            </div>

            <div className="stats-grid">
              <StatCard label="Posts published" value={payload.totals.publishedPosts} hint={`${days}-day window`} />
              <StatCard label="Total reach" value={payload.totals.reach.toLocaleString()} hint={isSimulated ? 'Simulated' : 'Live'} />
              <StatCard label="Total likes" value={payload.totals.likes.toLocaleString()} hint={isSimulated ? 'Simulated' : 'Live'} />
              <StatCard label="Total comments" value={payload.totals.comments.toLocaleString()} hint={isSimulated ? 'Simulated' : 'Live'} />
            </div>

            <div className="marketing-stack" style={{ marginTop: 14 }}>
              {payload.topPosts.length === 0 ? (
                <EmptyState title="No posts in window" description="Publish posts in the calendar to start tracking engagement here." />
              ) : (
                payload.topPosts.map((post) => (
                  <div key={post.postId} className="marketing-summary-card">
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                      <strong>{post.title}</strong>
                      <Badge tone={post.simulated ? 'warning' : 'positive'}>
                        {post.simulated ? 'Simulated' : 'Live'} · {post.platform}
                      </Badge>
                    </div>
                    <span>{post.venue}{post.publishedAt ? ` · ${new Date(post.publishedAt).toLocaleDateString()}` : ''}</span>
                    {post.caption ? <span style={{ color: 'rgba(15,23,42,0.55)' }}>{post.caption}</span> : null}
                    <div className="marketing-badges">
                      {post.metrics.reach !== null ? <Badge tone="info">{post.metrics.reach.toLocaleString()} reach</Badge> : null}
                      {post.metrics.likes !== null ? <Badge tone="info">{post.metrics.likes.toLocaleString()} likes</Badge> : null}
                      {post.metrics.comments !== null ? <Badge tone="info">{post.metrics.comments.toLocaleString()} comments</Badge> : null}
                      {post.metrics.shares !== null ? <Badge tone="info">{post.metrics.shares.toLocaleString()} shares</Badge> : null}
                      {post.engagementRate !== null ? <Badge tone="info">{post.engagementRate}% engagement</Badge> : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : null}
      </Card>
    </section>
  );
}

export function App() {
  const auth = useMarketingAuth();

  if (auth.loading) {
    return (
      <div className="login-page">
        <Spinner label="Checking session" />
      </div>
    );
  }

  if (!auth.user) return <LoginScreen onLogin={auth.login} />;

  return <MarketingWorkspace user={auth.user} onLogout={auth.logout} />;
}
