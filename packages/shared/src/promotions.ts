/**
 * Alma Menus — promotions: the one record behind a What's On listing and, when
 * a card is linked, its printed A5 menu.
 *
 * Pure and shared by the API (promotion service, public What's On endpoint)
 * and the editor (promotion form, listing preview), so a rule is written and
 * tested once. Nothing here touches a database.
 *
 * Vocabulary:
 *   PromotionFields    the working copy staff edit: listing text, schedule, price, booking
 *   PublicPromotion    the listing item exactly as the website receives it, frozen per publish
 *   card               the linked PROMOTION menu (the printed A5), whose when-line, hero
 *                      price and conditions come from the promotion so they are typed once
 */
import { z } from 'zod';
import { formatMenuPrice, MENU_LIMITS, type MenuActor, type MenuKind, type MenuPublishPreview, type MenuSummary, type MenuVersionSummary } from './menus.js';

export const PROMOTION_STATUSES = ['DRAFT', 'PUBLISHED', 'HIDDEN', 'ENDED'] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

export const PROMOTION_STATUS_LABELS: Record<PromotionStatus, string> = {
  DRAFT: 'Not yet published',
  PUBLISHED: 'Live',
  HIDDEN: 'Hidden',
  ENDED: 'Ended'
};

export function isPromotionStatus(value: unknown): value is PromotionStatus {
  return typeof value === 'string' && (PROMOTION_STATUSES as readonly string[]).includes(value);
}

/** Where the listing's booking button goes: the venue's OpenTable deep link, a URL, or nowhere. */
export const PROMOTION_BOOKINGS = ['OPENTABLE', 'URL', 'NONE'] as const;
export type PromotionBooking = (typeof PROMOTION_BOOKINGS)[number];

export const PROMOTION_BOOKING_LABELS: Record<PromotionBooking, string> = {
  OPENTABLE: 'Reserve on OpenTable (the venue’s booking link)',
  URL: 'A link you give',
  NONE: 'No booking button'
};

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const PROMOTION_LIMITS = {
  nameMax: 60,
  titleMax: 80,
  summaryMax: 600,
  dayLabelMax: 24,
  cadenceLabelMax: 24,
  timeLabelMax: MENU_LIMITS.whenLineMax,
  priceLabelMax: 24,
  conditionsMax: MENU_LIMITS.conditionsMax,
  bookLabelMax: 24,
  bookUrlMax: 400,
  altMax: 160,
  fileNameMax: 120,
  /** Listing photos are a few hundred KB; 4 MB leaves room under the API's 6 MB JSON body limit once base64-encoded. */
  imageBytesMax: 4 * 1024 * 1024,
  sortOrderMax: 999
} as const;

const trimmed = (max: number) => z.string().trim().max(max);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-14.');
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour time like 17:00.');

/** The working copy, every field with its default so a form can be built from `{}`. */
export const promotionFieldsSchema = z.object({
  name: trimmed(PROMOTION_LIMITS.nameMax).min(1, 'Give the promotion a name.'),
  publicTitle: trimmed(PROMOTION_LIMITS.titleMax).default(''),
  summary: trimmed(PROMOTION_LIMITS.summaryMax).default(''),
  dayLabel: trimmed(PROMOTION_LIMITS.dayLabelMax).default(''),
  cadenceLabel: trimmed(PROMOTION_LIMITS.cadenceLabelMax).default(''),
  timeLabel: trimmed(PROMOTION_LIMITS.timeLabelMax).default(''),
  validDays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .default([])
    .transform((days) => Array.from(new Set(days)).sort((a, b) => a - b)),
  startTime: timeOfDay.nullable().default(null),
  startsOn: dateOnly.nullable().default(null),
  endsOn: dateOnly.nullable().default(null),
  heroPriceCents: z.number().int().min(0).max(MENU_LIMITS.priceCentsMax).nullable().default(null),
  heroPriceUnit: trimmed(MENU_LIMITS.priceUnitMax).transform((unit) => unit || null).nullable().default(null),
  priceLabel: trimmed(PROMOTION_LIMITS.priceLabelMax).default(''),
  conditions: trimmed(PROMOTION_LIMITS.conditionsMax).default(''),
  bookDestination: z.enum(PROMOTION_BOOKINGS).default('OPENTABLE'),
  bookLabel: trimmed(PROMOTION_LIMITS.bookLabelMax).default(''),
  bookUrl: z.string().trim().max(PROMOTION_LIMITS.bookUrlMax).url('Use a full link, starting with https://.').nullable().default(null),
  sortOrder: z.number().int().min(0).max(PROMOTION_LIMITS.sortOrderMax).default(0)
});

export type PromotionFields = z.infer<typeof promotionFieldsSchema>;

export const PROMOTION_FIELD_DEFAULTS: PromotionFields = promotionFieldsSchema.parse({ name: 'Promotion' });

function windowOk(fields: { startsOn: string | null; endsOn: string | null }): boolean {
  return !fields.startsOn || !fields.endsOn || fields.startsOn <= fields.endsOn;
}

function bookingOk(fields: { bookDestination: PromotionBooking; bookUrl: string | null }): boolean {
  return fields.bookDestination !== 'URL' || Boolean(fields.bookUrl);
}

/** POST /api/menus/promotions */
export const promotionCreateInputSchema = promotionFieldsSchema
  .partial()
  .extend({
    venueId: z.string().min(1),
    name: promotionFieldsSchema.shape.name,
    /** Link an existing promotion card (a PROMOTION menu of the same venue), or … */
    menuId: z.string().min(1).nullable().optional(),
    /** … make a new card with the same name on the venue's A5 template. */
    createCard: z.boolean().default(false)
  })
  .refine((input) => !(input.menuId && input.createCard), { message: 'Link a card or make one, not both.', path: ['menuId'] });
export type PromotionCreateInput = z.infer<typeof promotionCreateInputSchema>;

/** PATCH /api/menus/promotions/:id — any subset of the fields, plus the link and the optimistic lock. */
export const promotionUpdateInputSchema = promotionFieldsSchema
  .partial()
  .extend({
    menuId: z.string().min(1).nullable().optional(),
    expectedUpdatedAt: z.string().optional()
  })
  .refine((input) => Object.keys(input).some((key) => key !== 'expectedUpdatedAt'), { message: 'Nothing to change.' });
export type PromotionUpdateInput = z.infer<typeof promotionUpdateInputSchema>;

/** POST /api/menus/promotions/:id/publish */
export const promotionPublishInputSchema = z.object({
  acknowledgeWarnings: z.boolean().default(false),
  expectedUpdatedAt: z.string().optional()
});
export type PromotionPublishInput = z.infer<typeof promotionPublishInputSchema>;

/** PUT /api/menus/promotions/:id/image — the photo as a data URL (png, jpeg or webp). */
export const promotionImageInputSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/s, 'Choose a PNG, JPEG or WebP image.'),
  fileName: trimmed(PROMOTION_LIMITS.fileNameMax).default('photo'),
  alt: trimmed(PROMOTION_LIMITS.altMax).default('')
});
export type PromotionImageInput = z.infer<typeof promotionImageInputSchema>;

export type PromotionIssue = { level: 'error' | 'warning'; code: string; message: string; field?: keyof PromotionFields };

/**
 * What stops a promotion being published, and what deserves a second look.
 * The card has its own validator; this is the listing's.
 */
export function validatePromotionFields(fields: PromotionFields): { errors: PromotionIssue[]; warnings: PromotionIssue[] } {
  const errors: PromotionIssue[] = [];
  const warnings: PromotionIssue[] = [];
  if (!fields.name.trim()) errors.push({ level: 'error', code: 'NAME', message: 'Give the promotion a name.', field: 'name' });
  if (!windowOk(fields)) errors.push({ level: 'error', code: 'WINDOW', message: 'The promotion ends before it starts.', field: 'endsOn' });
  if (!bookingOk(fields)) errors.push({ level: 'error', code: 'BOOK_URL', message: 'Give the booking link, or choose a different booking button.', field: 'bookUrl' });
  if (!fields.summary.trim()) warnings.push({ level: 'warning', code: 'NO_SUMMARY', message: 'The listing has no description.', field: 'summary' });
  if (!fields.timeLabel.trim()) warnings.push({ level: 'warning', code: 'NO_TIME', message: 'The listing has no day or time line.', field: 'timeLabel' });
  if (fields.bookDestination === 'OPENTABLE' && fields.validDays.length === 0) {
    warnings.push({ level: 'warning', code: 'NO_DAYS', message: 'No weekdays are ticked, so the booking button cannot pick the next date.', field: 'validDays' });
  }
  return { errors, warnings };
}

/** "$99 pp", "$5 tacos" (the override), or "Walk-in" when there is no price. */
export function promotionPriceLabel(fields: Pick<PromotionFields, 'heroPriceCents' | 'heroPriceUnit' | 'priceLabel'>): string {
  if (fields.priceLabel.trim()) return fields.priceLabel.trim();
  if (fields.heroPriceCents === null) return 'Walk-in';
  return `$${formatMenuPrice(fields.heroPriceCents, fields.heroPriceUnit)}`;
}

/** Today's date, venue-local (Sydney), as YYYY-MM-DD. */
export function venueToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** A listing is shown while it has started (or has no start) and has not ended (or has no end). */
export function promotionRunsOn(window: { startsOn: string | null; endsOn: string | null }, today: string): boolean {
  if (window.startsOn && window.startsOn > today) return false;
  if (window.endsOn && window.endsOn < today) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export type PromotionImageSummary = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  fingerprint: string;
  alt: string;
  /** Public, immutable: /api/public/promotion-images/:fingerprint */
  url: string;
  createdAt: string;
};

export type PromotionPublicationSummary = {
  id: string;
  number: number;
  publishedAt: string;
  publishedBy: MenuActor;
  /** The card version that publication listed, when a card was linked. */
  cardVersion: MenuVersionSummary | null;
};

export type PromotionSummary = {
  id: string;
  venue: { id: string; name: string; slug: string };
  slug: string;
  name: string;
  publicTitle: string;
  status: PromotionStatus;
  sortOrder: number;
  dayLabel: string;
  cadenceLabel: string;
  timeLabel: string;
  startsOn: string | null;
  endsOn: string | null;
  /** As the listing shows it: the override, the hero price, or "Walk-in". */
  priceLabel: string;
  heroPriceCents: number | null;
  heroPriceUnit: string | null;
  image: PromotionImageSummary | null;
  /** The linked card, as the Menus home shows menus. */
  card: MenuSummary | null;
  /** The latest publication, what the website serves while the promotion is PUBLISHED. */
  publication: PromotionPublicationSummary | null;
  /** The working copy, photo or card differs from the latest publication. */
  unpublishedChanges: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: MenuActor;
};

export type PromotionDetail = PromotionSummary & {
  fields: PromotionFields;
  /** The listing as it would publish now. */
  listing: PublicPromotion;
  /** The listing the website serves now (null before the first publish). */
  publishedListing: PublicPromotion | null;
  publications: PromotionPublicationSummary[];
};

export type PromotionListPayload = {
  promotions: PromotionSummary[];
  ended: PromotionSummary[];
  /** PROMOTION menus not linked to any promotion, per venue, for the link picker. */
  unlinkedCards: MenuSummary[];
};

export type PromotionCardAction =
  /** No card linked. */
  | 'NONE'
  /** The card's live PDF already prints this promotion's when-line, price and conditions. */
  | 'CURRENT'
  /** The card has a draft: publishing the promotion publishes it. */
  | 'PUBLISH_DRAFT'
  /** The card has no draft but its live PDF is behind the promotion: it is re-rendered and republished. */
  | 'REPUBLISH'
  /** The card has never been published and has no draft: nothing to print, the listing goes out without a PDF. */
  | 'UNPUBLISHED';

export type PromotionPublishPreview = {
  validation: { errors: PromotionIssue[]; warnings: PromotionIssue[]; ok: boolean };
  listing: PublicPromotion;
  publishedListing: PublicPromotion | null;
  /** Human-readable: "price 89 pp → 99 pp", "photo changed", … */
  listingChanges: string[];
  card: { menuId: string; name: string; action: PromotionCardAction; preview: MenuPublishPreview | null } | null;
  canPublish: boolean;
};

// ---------------------------------------------------------------------------
// The public listing item (what the website receives)
// ---------------------------------------------------------------------------

export type PublicPromotion = {
  /** venue slug + promotion slug identify the listing; the website anchors on `${venue.slug}/${slug}`. */
  slug: string;
  venue: { name: string; slug: string };
  title: string;
  summary: string;
  dayLabel: string;
  cadenceLabel: string;
  timeLabel: string;
  validDays: number[];
  startTime: string | null;
  startsOn: string | null;
  endsOn: string | null;
  priceLabel: string;
  price: { cents: number; unit: string | null } | null;
  conditions: string;
  booking: { destination: PromotionBooking; label: string; url: string | null };
  image: { url: string; width: number | null; height: number | null; alt: string } | null;
  /** The printed card, when one is linked and published: immutable PDF for this publication, live PDF by slug. */
  card: { slug: string; name: string; heading: string; versionId: string; pdfUrl: string; livePdfUrl: string; jsonUrl: string } | null;
  publishedAt: string;
  publicationId: string;
  sortOrder: number;
};

export type PublicWhatsOn = {
  venues: Array<{ name: string; slug: string }>;
  promotions: PublicPromotion[];
  generatedAt: string;
};

/** The listing item, built from the working copy. The service fills in URLs and the publication identity. */
export function buildPublicPromotion(input: {
  slug: string;
  venue: { name: string; slug: string };
  fields: PromotionFields;
  image: { url: string; width: number | null; height: number | null; alt: string } | null;
  card: PublicPromotion['card'];
  publishedAt: string;
  publicationId: string;
}): PublicPromotion {
  const { fields } = input;
  return {
    slug: input.slug,
    venue: { name: input.venue.name, slug: input.venue.slug },
    title: fields.publicTitle.trim() || fields.name.trim(),
    summary: fields.summary,
    dayLabel: fields.dayLabel,
    cadenceLabel: fields.cadenceLabel,
    timeLabel: fields.timeLabel,
    validDays: fields.validDays,
    startTime: fields.startTime,
    startsOn: fields.startsOn,
    endsOn: fields.endsOn,
    priceLabel: promotionPriceLabel(fields),
    price: fields.heroPriceCents === null ? null : { cents: fields.heroPriceCents, unit: fields.heroPriceUnit },
    conditions: fields.conditions,
    booking: {
      destination: fields.bookDestination,
      label: fields.bookLabel.trim() || (fields.bookDestination === 'NONE' ? '' : 'Reserve'),
      url: fields.bookDestination === 'URL' ? fields.bookUrl : null
    },
    image: input.image,
    card: input.card,
    publishedAt: input.publishedAt,
    publicationId: input.publicationId,
    sortOrder: fields.sortOrder
  };
}

/** "Fri Sat Sun" — weekdays in Monday-first order, as people read a week. */
export function weekdayList(days: readonly number[]): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.filter((day) => days.includes(day)).map((day) => WEEKDAY_LABELS[day]).join(' ') || '—';
}

/** What the website would see change: field by field, in plain words. Identity fields (publishedAt, publicationId) are ignored. */
export function diffPublicPromotions(before: PublicPromotion | null, after: PublicPromotion): string[] {
  if (!before) return ['first publish'];
  const changes: string[] = [];
  const text = (label: string, a: string, b: string) => {
    if (a !== b) changes.push(a && b ? `${label} “${a}” → “${b}”` : a ? `${label} removed` : `${label} added`);
  };
  text('title', before.title, after.title);
  if (before.summary !== after.summary) changes.push('description changed');
  text('day', before.dayLabel, after.dayLabel);
  text('cadence', before.cadenceLabel, after.cadenceLabel);
  text('time', before.timeLabel, after.timeLabel);
  if (before.validDays.join(',') !== after.validDays.join(',')) changes.push(`weekdays ${weekdayList(before.validDays)} → ${weekdayList(after.validDays)}`);
  text('start time', before.startTime ?? '', after.startTime ?? '');
  text('starts', before.startsOn ?? '', after.startsOn ?? '');
  text('ends', before.endsOn ?? '', after.endsOn ?? '');
  text('price', before.priceLabel, after.priceLabel);
  if (before.conditions !== after.conditions) changes.push('conditions changed');
  if (before.booking.destination !== after.booking.destination || before.booking.url !== after.booking.url || before.booking.label !== after.booking.label) changes.push('booking button changed');
  if ((before.image?.url ?? null) !== (after.image?.url ?? null)) changes.push(before.image && after.image ? 'photo changed' : after.image ? 'photo added' : 'photo removed');
  else if (before.image && after.image && before.image.alt !== after.image.alt) changes.push('photo description changed');
  if ((before.card?.versionId ?? null) !== (after.card?.versionId ?? null)) {
    changes.push(before.card && after.card ? 'menu PDF updated' : after.card ? 'menu PDF added' : 'menu PDF removed');
  }
  if (before.sortOrder !== after.sortOrder) changes.push(`order ${before.sortOrder} → ${after.sortOrder}`);
  return changes;
}

/**
 * The card fields a linked promotion owns. Applied to the card's document
 * before validation, preview, save and publish, so what prints is always what
 * the promotion says — typed once, in one place.
 */
export function promotionCardOverlay(fields: Pick<PromotionFields, 'timeLabel' | 'heroPriceCents' | 'heroPriceUnit' | 'conditions'>): {
  whenLine: string;
  heroPriceCents: number | null;
  heroPriceUnit: string | null;
  conditions: string;
} {
  return { whenLine: fields.timeLabel, heroPriceCents: fields.heroPriceCents, heroPriceUnit: fields.heroPriceUnit, conditions: fields.conditions };
}

/** The menu kinds a promotion may link to as its card. */
export const PROMOTION_CARD_KINDS: readonly MenuKind[] = ['PROMOTION'];
