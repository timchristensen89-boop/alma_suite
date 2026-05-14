import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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
  MarketingSocialAccount,
  ReserveGuest,
  ReserveReservation,
  SocialPlatform
} from '@alma/shared';
import {
  ActionFeedback,
  AppShell,
  Badge,
  Button,
  Card,
  DocumentIcon,
  EmptyState,
  GearIcon,
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
  { href: '#dashboard', label: 'Dashboard', description: 'Guests and recent activity', icon: <DocumentIcon /> },
  { href: '#content', label: 'Content', description: 'Assets, posts, calendar', icon: <DocumentIcon /> },
  { href: '#guests', label: 'Guests', description: 'Profiles, consent, and tags', icon: <SearchIcon /> },
  { href: '#segments', label: 'Segments', description: 'Tag and audience logic', icon: <GearIcon /> },
  { href: '#templates', label: 'Templates', description: 'Reusable email content', icon: <DocumentIcon /> },
  { href: '#campaigns', label: 'Campaigns', description: 'Preview and simulate', icon: <DocumentIcon /> },
  { href: '#automations', label: 'Automations', description: 'Trigger-based drafts', icon: <GearIcon /> }
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

function defaultFeedback(): FeedbackState {
  return { target: null, message: null, tone: 'success' };
}

function isAdmin(user: AuthUser) {
  return Boolean(user.isAdmin || user.role === 'ADMIN');
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

function SidebarNav() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeHash, setActiveHash] = useState('#dashboard');

  useEffect(() => {
    const syncHash = () => setActiveHash(window.location.hash || '#dashboard');
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  const active = MARKETING_NAV_ITEMS.find((item) => item.href === activeHash) ?? MARKETING_NAV_ITEMS[0]!;

  return (
    <>
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

function MarketingWorkspace({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
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
  const [campaignPreview, setCampaignPreview] = useState<CampaignPreviewResult | null>(null);
  const [contentDashboard, setContentDashboard] = useState<MarketingContentDashboardSummary | null>(null);
  const [contentAssets, setContentAssets] = useState<MarketingContentAsset[]>([]);
  const [contentPosts, setContentPosts] = useState<MarketingContentPost[]>([]);
  const [contentCalendar, setContentCalendar] = useState<MarketingContentCalendarResponse | null>(null);
  const [contentUploadConfig, setContentUploadConfig] = useState<MarketingContentUploadConfigResponse | null>(null);
  const [contentHelpers, setContentHelpers] = useState<MarketingContentHelper[]>([]);
  const [contentPublishPreview, setContentPublishPreview] = useState<ContentPublishPreviewResult | null>(null);

  const venueParam = venueFilter === ALL_VENUES ? '' : venueFilter;
  const defaultVenue = venueParam || user.venue || KNOWN_VENUES[0]!;
  const [tagForm, setTagForm] = useState<TagForm>(() => defaultTagForm(defaultVenue));
  const [segmentForm, setSegmentForm] = useState<SegmentBuilder>(() => defaultSegmentBuilder(venueFilter));
  const [templateForm, setTemplateForm] = useState<TemplateForm>(() => defaultTemplateForm(defaultVenue));
  const [campaignForm, setCampaignForm] = useState<CampaignForm>(() => defaultCampaignForm(defaultVenue));
  const [automationForm, setAutomationForm] = useState<AutomationForm>(() => defaultAutomationForm(defaultVenue));
  const [contentAssetForm, setContentAssetForm] = useState<ContentAssetForm>(() => defaultContentAssetForm(defaultVenue));
  const [contentPostForm, setContentPostForm] = useState<ContentPostForm>(() => defaultContentPostForm(defaultVenue));

  const tags = overview?.tags ?? [];
  const templates = overview?.templates ?? [];
  const campaigns = overview?.campaigns ?? [];
  const automations = overview?.automations ?? [];
  const recentReservations = overview?.recentReservations ?? [];
  const socialAccounts = contentDashboard?.socialAccounts ?? [];
  const postsNeedingReview = contentPosts.filter((post) => post.status === 'NEEDS_REVIEW');
  const upcomingContentPosts = contentCalendar?.posts ?? contentDashboard?.upcomingPosts ?? [];
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
    try {
      const preview = await api<CampaignPreviewResult>(`/api/marketing/campaigns/${campaignId}/preview-recipients`, {
        method: 'POST'
      });
      setCampaignPreview(preview);
      setSuccess(`campaign-preview:${campaignId}`, 'Recipient preview refreshed.');
    } catch (error) {
      setError(`campaign-preview:${campaignId}`, error, 'Could not preview recipients.');
    }
  }

  async function simulateCampaign(campaignId: string) {
    try {
      const preview = await api<CampaignPreviewResult>(`/api/marketing/campaigns/${campaignId}/simulate-send`, {
        method: 'POST'
      });
      setCampaignPreview(preview);
      setSuccess(`campaign-simulate:${campaignId}`, preview.message || 'Campaign simulation completed.');
      await load();
    } catch (error) {
      setError(`campaign-simulate:${campaignId}`, error, 'Could not simulate campaign.');
    }
  }

  async function saveAutomation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setSuccess('content-asset', 'Asset registered and ready to attach.');
      await load();
    } catch (error) {
      setError('content-asset', error, 'Could not register asset.');
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

  async function createSetupAccount(platform: SocialPlatform) {
    try {
      await api<MarketingSocialAccount>('/api/marketing/content/social-accounts', {
        method: 'POST',
        body: JSON.stringify({
          venue: defaultVenue,
          platform,
          displayName: `${defaultVenue} ${platform.toLowerCase()} setup`,
          status: 'SETUP_REQUIRED',
          scopes: []
        })
      });
      setSuccess('social-account', `${platform} setup card created.`);
      await load();
    } catch (error) {
      setError('social-account', error, 'Could not create social setup card.');
    }
  }

  return (
    <AppShell
      brand={<ProductLogo appId="marketing" size="md" showBrandMark={false} />}
      sidebar={<SidebarNav />}
      topBar={
        <TopBar
          title="ALMA Marketing"
          subtitle="Guest CRM, segments, campaigns, and automations"
          right={
            <>
              <SuiteAppSwitcher currentApp="marketing" apps={suiteApps} variant="topbar" />
              <SuiteCommsWidget
                appId="MARKETING"
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
      <div className="marketing-page">
        <PageHeader
          eyebrow="ALMA Marketing"
          title="Restaurant marketing control centre"
          description="Consent-aware guest marketing with manual tags, auto-tags, segments, templates, campaigns, and automation simulation only."
          actions={
            <>
              <Select label="Venue" value={venueFilter} onChange={(event) => setVenueFilter(event.currentTarget.value)} options={options} />
              <Input label="Guest search" value={guestSearch} onChange={(event) => setGuestSearch(event.currentTarget.value)} placeholder="Name, email, or phone" />
              <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>Refresh</Button>
            </>
          }
        />

        {feedback.target === 'page' && feedback.message ? <p className="error-text">{feedback.message}</p> : null}

        <div className="stats-grid">
          <StatCard label="Guests" value={overview?.totals.guests ?? 0} hint="Visible in current scope" loading={loading} />
          <StatCard label="Opted in" value={overview?.totals.optedInGuests ?? 0} hint="Marketing consent present" loading={loading} />
          <StatCard label="Repeat visitors" value={overview?.totals.repeatVisitors ?? 0} hint="2+ visits" loading={loading} />
          <StatCard label="Lapsed guests" value={overview?.totals.lapsedGuests ?? 0} hint="90+ days since last visit" loading={loading} />
        </div>

        <div className="marketing-layout">
          <section className="marketing-main">
            <section id="dashboard">
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
              </Card>
            </section>

            <section id="content">
              <Card title="Content Studio" subtitle="Social assets, post drafts, approval, scheduling, and simulation-only publishing">
                <div className="stats-grid compact">
                  <StatCard label="Assets" value={contentDashboard?.totals.assets ?? 0} hint={`${contentDashboard?.totals.images ?? 0} images · ${contentDashboard?.totals.videos ?? 0} videos`} loading={loading} />
                  <StatCard label="Drafts" value={contentDashboard?.totals.drafts ?? 0} hint="Ideas and drafts" loading={loading} />
                  <StatCard label="Needs review" value={contentDashboard?.totals.needsReview ?? 0} hint="Approval queue" loading={loading} />
                  <StatCard label="Scheduled" value={contentDashboard?.totals.scheduledPosts ?? 0} hint="On the content calendar" loading={loading} />
                </div>

                <div className="content-studio-grid">
                  <div className="marketing-stack">
                    <Card title="Register asset" subtitle={contentUploadConfig?.message ?? 'Register images and videos for social posts.'}>
                      <form className="marketing-form" onSubmit={(event) => void saveContentAsset(event)}>
                        <div className="form-grid two">
                          <Select label="Venue" value={contentAssetForm.venue} onChange={(event) => setContentAssetForm((current) => ({ ...current, venue: event.currentTarget.value }))} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                          <Select label="Type" value={contentAssetForm.assetType} onChange={(event) => setContentAssetForm((current) => ({ ...current, assetType: event.currentTarget.value as MarketingContentAssetType }))} options={CONTENT_ASSET_TYPES.map((value) => ({ label: value, value }))} />
                          <Input label="Title" required value={contentAssetForm.title} onChange={(event) => setContentAssetForm((current) => ({ ...current, title: event.currentTarget.value }))} />
                          <Input label="File name" required value={contentAssetForm.fileName} onChange={(event) => setContentAssetForm((current) => ({ ...current, fileName: event.currentTarget.value }))} />
                          <Input label="MIME type" required value={contentAssetForm.mimeType} onChange={(event) => setContentAssetForm((current) => ({ ...current, mimeType: event.currentTarget.value }))} />
                          <Input label="File size bytes" type="number" min="0" required value={contentAssetForm.fileSizeBytes} onChange={(event) => setContentAssetForm((current) => ({ ...current, fileSizeBytes: event.currentTarget.value }))} />
                        </div>
                        <Input label="Public media URL" type="url" required value={contentAssetForm.publicUrl} onChange={(event) => setContentAssetForm((current) => ({ ...current, publicUrl: event.currentTarget.value }))} placeholder="https://..." />
                        <Input label="Thumbnail URL" type="url" value={contentAssetForm.thumbnailUrl} onChange={(event) => setContentAssetForm((current) => ({ ...current, thumbnailUrl: event.currentTarget.value }))} placeholder="Optional" />
                        <Input label="Tags" value={contentAssetForm.tags} onChange={(event) => setContentAssetForm((current) => ({ ...current, tags: event.currentTarget.value }))} placeholder="food, event, margarita" />
                        <Textarea label="Description" rows={2} value={contentAssetForm.description} onChange={(event) => setContentAssetForm((current) => ({ ...current, description: event.currentTarget.value }))} />
                        <div className="toolbar-right">
                          <ActionFeedback message={feedback.target === 'content-asset' ? feedback.message : null} tone={feedback.tone} />
                          <Button type="submit">Register asset</Button>
                        </div>
                      </form>
                    </Card>

                    <Card title="Content library" subtitle="Ready assets for posts">
                      {contentAssets.length === 0 ? (
                        <EmptyState title="No assets registered" description="Add a public image or video URL to start building post drafts." />
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

                  <div className="marketing-stack">
                    <Card title="Post composer" subtitle="Facebook, Instagram, and TikTok previews. Live publish stays setup required.">
                      <div className="marketing-summary-card">
                        <strong>Hospitality helpers</strong>
                        <span>Prefill post and campaign copy for bookings, gift cards, functions, specials, events, cocktails, and staff stories.</span>
                        <div className="marketing-badges">
                          {contentHelpers.map((helper) => (
                            <span key={helper.id} className="marketing-tag-chip">
                              <Button type="button" size="sm" variant="secondary" onClick={() => applyContentHelper(helper)}>
                                {helper.label}
                              </Button>
                              <Button type="button" size="sm" variant="ghost" onClick={() => void createPostFromHelper(helper)}>
                                Create draft
                              </Button>
                            </span>
                          ))}
                        </div>
                        <ActionFeedback message={feedback.target === 'content-helper' ? feedback.message : null} tone={feedback.tone} />
                      </div>
                      <form className="marketing-form" onSubmit={(event) => void saveContentPost(event)}>
                        <div className="form-grid two">
                          <Select label="Venue" value={contentPostForm.venue} onChange={(event) => setContentPostForm((current) => ({ ...current, venue: event.currentTarget.value }))} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                          <Select label="Pillar" value={contentPostForm.contentPillar} onChange={(event) => setContentPostForm((current) => ({ ...current, contentPillar: event.currentTarget.value }))} options={CONTENT_PILLARS.map((value) => ({ label: prettyLabel(value), value }))} />
                          <Input label="Title" required value={contentPostForm.title} onChange={(event) => setContentPostForm((current) => ({ ...current, title: event.currentTarget.value }))} />
                          <Input label="Schedule" type="datetime-local" value={contentPostForm.scheduledAt} onChange={(event) => setContentPostForm((current) => ({ ...current, scheduledAt: event.currentTarget.value }))} />
                        </div>
                        <Textarea label="Caption" rows={5} required value={contentPostForm.caption} onChange={(event) => setContentPostForm((current) => ({ ...current, caption: event.currentTarget.value }))} />
                        <Select label="Attach asset" value={contentPostForm.assetId} onChange={(event) => setContentPostForm((current) => ({ ...current, assetId: event.currentTarget.value }))} options={[{ label: 'No asset attached', value: '' }, ...contentAssets.map((asset) => ({ label: `${asset.title} · ${asset.assetType}`, value: asset.id }))]} />
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
                          {contentPosts.slice(0, 10).map((post) => (
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
                                <Button type="button" size="sm" variant="ghost" disabled title="Live publish requires Meta/TikTok OAuth setup">Live publish setup required</Button>
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
                          ))}
                        </div>
                      )}
                    </Card>
                  </div>
                </div>

                <div className="content-bottom-grid">
                  <Card title="Content calendar" subtitle="Scheduled and approved social posts">
                    {upcomingContentPosts.length === 0 ? (
                      <EmptyState title="No scheduled content" description="Save a post with a schedule time, then approve and simulate it." />
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

                  <Card title="Social accounts" subtitle="Readiness for Facebook, Instagram, and TikTok">
                    <div className="social-account-grid">
                      {SOCIAL_PLATFORMS.map((platform) => {
                        const account = socialAccounts.find((item) => item.platform === platform && item.venue === defaultVenue);
                        return (
                          <div key={platform} className="social-account-card">
                            <strong>{platform}</strong>
                            <Badge tone={account?.status === 'CONNECTED' ? 'positive' : 'warning'}>{account?.status ?? 'SETUP_REQUIRED'}</Badge>
                            <span>{account?.displayName ?? `${defaultVenue} account not connected`}</span>
                            <small>{account?.hasTokenSecretRef ? 'Secret reference present' : 'No OAuth secret reference exposed or configured'}</small>
                            {!account ? <Button type="button" size="sm" variant="secondary" onClick={() => void createSetupAccount(platform)}>Create setup card</Button> : null}
                          </div>
                        );
                      })}
                    </div>
                    <ActionFeedback message={feedback.target === 'social-account' ? feedback.message : null} tone={feedback.tone} />
                  </Card>
                </div>

                {contentPublishPreview ? (
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
                          <Badge key={attempt.id} tone={attempt.status === 'SIMULATED' ? 'positive' : 'warning'}>
                            {attempt.platform}: {attempt.status}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                ) : null}
              </Card>
            </section>

            <section id="guests">
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

            <section id="segments">
              <Card title="Tags and segments" subtitle="Manual tags plus automatic audience rules">
              <div className="marketing-section-grid">
                <div className="marketing-stack">
                  <Card title="Create tag" subtitle="Manual tags stay separate from automatic recalculation">
                    <form className="marketing-form" onSubmit={(event) => void saveTag(event)}>
                      <div className="form-grid two">
                        <Select label="Venue" value={tagForm.venue} onChange={(event) => setTagForm((current) => ({ ...current, venue: event.currentTarget.value }))} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                        <Select label="Type" value={tagForm.type} onChange={(event) => setTagForm((current) => ({ ...current, type: event.currentTarget.value as GuestTagType }))} options={TAG_TYPES.map((value) => ({ label: value, value }))} />
                        <Input label="Tag name" required value={tagForm.name} onChange={(event) => setTagForm((current) => ({ ...current, name: event.currentTarget.value }))} />
                        <Input label="Colour" value={tagForm.color} onChange={(event) => setTagForm((current) => ({ ...current, color: event.currentTarget.value }))} />
                      </div>
                      <Textarea label="Description" rows={2} value={tagForm.description} onChange={(event) => setTagForm((current) => ({ ...current, description: event.currentTarget.value }))} />
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
                        <Select label="Venue" value={segmentForm.venue} onChange={(event) => setSegmentForm((current) => ({ ...current, venue: event.currentTarget.value }))} options={options.filter((option) => option.value !== ALL_VENUES)} />
                        <Select label="Channel" value={segmentForm.channel} onChange={(event) => setSegmentForm((current) => ({ ...current, channel: event.currentTarget.value as MarketingChannel }))} options={CAMPAIGN_CHANNELS.map((value) => ({ label: value, value }))} />
                        <Input label="Search filter" value={segmentForm.search} onChange={(event) => setSegmentForm((current) => ({ ...current, search: event.currentTarget.value }))} />
                        <Select label="Must have tag" value={segmentForm.tagId} onChange={(event) => setSegmentForm((current) => ({ ...current, tagId: event.currentTarget.value }))} options={[{ label: 'Any tag state', value: '' }, ...tags.map((tag) => ({ label: tag.name, value: tag.id }))]} />
                        <Select label="Exclude tag" value={segmentForm.excludedTagId} onChange={(event) => setSegmentForm((current) => ({ ...current, excludedTagId: event.currentTarget.value }))} options={[{ label: 'No excluded tag', value: '' }, ...tags.map((tag) => ({ label: tag.name, value: tag.id }))]} />
                        <Input label="Minimum visits" type="number" min="0" value={segmentForm.minVisits} onChange={(event) => setSegmentForm((current) => ({ ...current, minVisits: event.currentTarget.value }))} />
                        <Input label="Maximum visits" type="number" min="0" value={segmentForm.maxVisits} onChange={(event) => setSegmentForm((current) => ({ ...current, maxVisits: event.currentTarget.value }))} />
                        <Input label="Last visit older than days" type="number" min="0" value={segmentForm.maxDaysSinceVisit} onChange={(event) => setSegmentForm((current) => ({ ...current, maxDaysSinceVisit: event.currentTarget.value }))} />
                        <Input label="Last visit within days" type="number" min="0" value={segmentForm.lastVisitWithinDays} onChange={(event) => setSegmentForm((current) => ({ ...current, lastVisitWithinDays: event.currentTarget.value }))} />
                        <Input label="Birthday within days" type="number" min="1" value={segmentForm.birthdaysWithinDays} onChange={(event) => setSegmentForm((current) => ({ ...current, birthdaysWithinDays: event.currentTarget.value }))} />
                        <Input label="Minimum spend cents" type="number" min="0" value={segmentForm.minSpendCents} onChange={(event) => setSegmentForm((current) => ({ ...current, minSpendCents: event.currentTarget.value }))} />
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
                        <Button type="submit">Preview segment</Button>
                      </div>
                    </form>
                    {segmentPreview ? (
                      <div className="marketing-stack">
                        <div className="marketing-summary-card">
                          <strong>{segmentPreview.includedCount} included</strong>
                          <span>{segmentPreview.skippedCount} skipped · {segmentPreview.guestCount} total · {segmentPreview.estimatedReachableEmailCount} reachable email</span>
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
          </section>

          <aside className="marketing-side">
            <section id="templates">
              <Card title="Templates" subtitle="HTML accepted. Preview rendered inside a sandboxed iframe.">
              <form className="marketing-form" onSubmit={(event) => void saveTemplate(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={templateForm.venue} onChange={(event) => setTemplateForm((current) => ({ ...current, venue: event.currentTarget.value }))} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                  <Select label="Status" value={templateForm.status} onChange={(event) => setTemplateForm((current) => ({ ...current, status: event.currentTarget.value as TemplateForm['status'] }))} options={TEMPLATE_STATUSES.map((value) => ({ label: value, value }))} />
                  <Input label="Template name" required value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.currentTarget.value }))} />
                  <Input label="Subject" required value={templateForm.subject} onChange={(event) => setTemplateForm((current) => ({ ...current, subject: event.currentTarget.value }))} />
                </div>
                <Input label="Preview text" value={templateForm.previewText} onChange={(event) => setTemplateForm((current) => ({ ...current, previewText: event.currentTarget.value }))} />
                <Textarea label="HTML body" rows={8} value={templateForm.htmlBody} onChange={(event) => setTemplateForm((current) => ({ ...current, htmlBody: event.currentTarget.value }))} />
                <Textarea label="Text body" rows={4} value={templateForm.textBody} onChange={(event) => setTemplateForm((current) => ({ ...current, textBody: event.currentTarget.value }))} />
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

            <section id="campaigns">
              <Card title="Campaigns" subtitle="Recipient preview and simulation only. No external send.">
              <form className="marketing-form" onSubmit={(event) => void saveCampaign(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={campaignForm.venue} onChange={(event) => setCampaignForm((current) => ({ ...current, venue: event.currentTarget.value }))} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                  <Select label="Channel" value={campaignForm.channel} onChange={(event) => setCampaignForm((current) => ({ ...current, channel: event.currentTarget.value as MarketingChannel }))} options={CAMPAIGN_CHANNELS.map((value) => ({ label: value, value }))} />
                  <Input label="Campaign name" required value={campaignForm.name} onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.currentTarget.value }))} />
                  <Input label="Audience name" value={campaignForm.audienceName} onChange={(event) => setCampaignForm((current) => ({ ...current, audienceName: event.currentTarget.value }))} />
                  <Input label="Subject" value={campaignForm.subject} onChange={(event) => setCampaignForm((current) => ({ ...current, subject: event.currentTarget.value }))} />
                  <Input label="Preview text" value={campaignForm.previewText} onChange={(event) => setCampaignForm((current) => ({ ...current, previewText: event.currentTarget.value }))} />
                </div>
                <Textarea label="HTML body" rows={6} value={campaignForm.body} onChange={(event) => setCampaignForm((current) => ({ ...current, body: event.currentTarget.value }))} />
                <Textarea label="Text body" rows={3} value={campaignForm.textBody} onChange={(event) => setCampaignForm((current) => ({ ...current, textBody: event.currentTarget.value }))} />
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
                    <div className="marketing-badges">
                      <Button type="button" size="sm" variant="secondary" onClick={() => void previewCampaignRecipients(campaign.id)}>Preview</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => void createContentPostFromCampaign(campaign.id)}>Create social post</Button>
                      <Button type="button" size="sm" onClick={() => void simulateCampaign(campaign.id)}>Simulate send</Button>
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

            <section id="automations">
              <Card title="Automations" subtitle="Trigger-based audience selection with simulation only">
              <form className="marketing-form" onSubmit={(event) => void saveAutomation(event)}>
                <div className="form-grid two">
                  <Select label="Venue" value={automationForm.venue} onChange={(event) => setAutomationForm((current) => ({ ...current, venue: event.currentTarget.value }))} options={KNOWN_VENUES.map((value) => ({ label: value, value }))} />
                  <Select label="Trigger" value={automationForm.triggerType} onChange={(event) => setAutomationForm((current) => ({ ...current, triggerType: event.currentTarget.value as MarketingAutomationTriggerType }))} options={AUTOMATION_TRIGGERS.map((value) => ({ label: value.replace(/_/g, ' '), value }))} />
                  <Input label="Automation name" required value={automationForm.name} onChange={(event) => setAutomationForm((current) => ({ ...current, name: event.currentTarget.value }))} />
                  <Select label="Email template" value={automationForm.emailTemplateId} onChange={(event) => setAutomationForm((current) => ({ ...current, emailTemplateId: event.currentTarget.value }))} options={[{ label: 'No template yet', value: '' }, ...templates.map((template) => ({ label: `${template.name} · ${template.venue || 'Global'}`, value: template.id }))]} />
                  <Input label="Delay hours" type="number" min="0" value={automationForm.delayHours} onChange={(event) => setAutomationForm((current) => ({ ...current, delayHours: event.currentTarget.value }))} />
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
                {automations.slice(0, 5).map((automation) => (
                  <div key={automation.id} className="marketing-summary-card">
                    <strong>{automation.name}</strong>
                    <span>{automation.triggerType.replace(/_/g, ' ').toLowerCase()} · {automation.active ? 'active' : 'inactive'} · delay {automation.delayHours}h</span>
                    <div className="marketing-badges">
                      <Button type="button" size="sm" variant="secondary" onClick={() => void simulateAutomation(automation.id)}>Simulate</Button>
                    </div>
                    <ActionFeedback message={feedback.target === `automation:${automation.id}` ? feedback.message : null} tone={feedback.tone} />
                  </div>
                ))}
              </div>
              </Card>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
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
