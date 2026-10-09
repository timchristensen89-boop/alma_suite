import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@alma/db';
import type { Prisma } from '@prisma/client';
import {
  buildPublicPromotion,
  diffPublicPromotions,
  isPromotionStatus,
  menuSlug,
  PROMOTION_BOOKINGS,
  PROMOTION_LIMITS,
  promotionCardOverlay,
  promotionCreateInputSchema,
  promotionFieldsSchema,
  promotionImageInputSchema,
  promotionPriceLabel,
  promotionPublishInputSchema,
  promotionRunsOn,
  promotionUpdateInputSchema,
  validatePromotionFields,
  venueToday,
  type AuthUser,
  type MenuAuditEntry,
  type MenuPublishPreview,
  type MenuSummary,
  type PromotionBooking,
  type PromotionCardAction,
  type PromotionDetail,
  type PromotionFields,
  type PromotionImageSummary,
  type PromotionIssue,
  type PromotionListPayload,
  type PromotionPublicationSummary,
  type PromotionPublishPreview,
  type PromotionStatus,
  type PromotionSummary,
  type PublicPromotion,
  type PublicWhatsOn
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { imageDimensions } from '../lib/image-dimensions.js';
import { menuActor, menuPublishing, menuService, type Actor, type MenuRow, type VersionRow } from './menu.service.js';

/**
 * Promotions — one record behind a What's On listing and its printed card.
 *
 * Invariants this service keeps:
 *   - the public website only ever sees a PromotionPublication snapshot, and
 *     only the latest one of a PUBLISHED promotion that runs today. The
 *     working copy (the Promotion row) is never served.
 *   - "publish" lands the listing and the linked card's PDF in ONE
 *     transaction. The card is validated and rendered first, outside the
 *     transaction, by the menu publish's own rules; if anything fails, the
 *     previous publication, the card's live version and its PDF are exactly
 *     as they were, and the caller sees the menu's own error.
 *   - the card prints what the promotion says: its when-line, hero price and
 *     conditions are overlaid from the promotion (menu.service withPromotion).
 *     A publication lists the card version that printed those values, by an
 *     immutable PDF link, so the listing and the PDF cannot disagree.
 *   - a slug is minted once, at creation, and never changes.
 *   - a listing photo is immutable: replacing one adds a row and repoints the
 *     promotion, so earlier publications keep resolving.
 *   - every change writes a MenuAuditEvent with who, what and a summary.
 */

const IMAGE_SELECT = { id: true, fileName: true, mimeType: true, sizeBytes: true, width: true, height: true, fingerprint: true, alt: true, createdAt: true } as const;

const PUBLICATION_SELECT = {
  id: true,
  publicationNumber: true,
  snapshotJson: true,
  menuVersionId: true,
  publishedAt: true,
  publishedById: true,
  publishedByName: true,
  menuVersion: { select: menuPublishing.VERSION_SUMMARY_SELECT }
} as const;

const PROMOTION_SELECT = {
  id: true,
  venueId: true,
  slug: true,
  name: true,
  publicTitle: true,
  summary: true,
  dayLabel: true,
  cadenceLabel: true,
  timeLabel: true,
  validDays: true,
  startTime: true,
  startsOn: true,
  endsOn: true,
  heroPriceCents: true,
  heroPriceUnit: true,
  priceLabel: true,
  conditions: true,
  bookDestination: true,
  bookLabel: true,
  bookUrl: true,
  imageId: true,
  menuId: true,
  status: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  updatedById: true,
  updatedByName: true,
  venue: { select: { id: true, name: true, slug: true } },
  image: { select: IMAGE_SELECT },
  publications: { select: PUBLICATION_SELECT, orderBy: { publicationNumber: 'desc' as const }, take: 1 }
} as const;

type PromotionRow = Prisma.PromotionGetPayload<{ select: typeof PROMOTION_SELECT }>;
type ImageRow = Prisma.PromotionImageGetPayload<{ select: typeof IMAGE_SELECT }>;
type PublicationRow = Prisma.PromotionPublicationGetPayload<{ select: typeof PUBLICATION_SELECT }>;

/** The card as the promotion needs it: the menu row plus its live and draft versions. */
type CardState = {
  menu: MenuRow;
  published: VersionRow | null;
  draft: VersionRow | null;
  action: PromotionCardAction;
};

// ---------------------------------------------------------------------------
// Row → payload
// ---------------------------------------------------------------------------

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function dateFrom(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function statusOf(row: Pick<PromotionRow, 'status'>): PromotionStatus {
  return isPromotionStatus(row.status) ? row.status : 'DRAFT';
}

function bookingOf(value: string): PromotionBooking {
  return (PROMOTION_BOOKINGS as readonly string[]).includes(value) ? (value as PromotionBooking) : 'OPENTABLE';
}

function fieldsOf(row: PromotionRow): PromotionFields {
  return {
    name: row.name,
    publicTitle: row.publicTitle,
    summary: row.summary,
    dayLabel: row.dayLabel,
    cadenceLabel: row.cadenceLabel,
    timeLabel: row.timeLabel,
    validDays: Array.from(new Set(row.validDays)).sort((a, b) => a - b),
    startTime: row.startTime,
    startsOn: dateOnly(row.startsOn),
    endsOn: dateOnly(row.endsOn),
    heroPriceCents: row.heroPriceCents,
    heroPriceUnit: row.heroPriceUnit,
    priceLabel: row.priceLabel,
    conditions: row.conditions,
    bookDestination: bookingOf(row.bookDestination),
    bookLabel: row.bookLabel,
    bookUrl: row.bookUrl,
    sortOrder: row.sortOrder
  };
}

function imageExtension(mimeType: string): string {
  return mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
}

function imageUrl(image: Pick<ImageRow, 'fingerprint' | 'mimeType'>): string {
  return menuPublishing.publicUrl(`/api/public/promotion-images/${image.fingerprint}.${imageExtension(image.mimeType)}`);
}

function imageSummary(image: ImageRow | null): PromotionImageSummary | null {
  if (!image) return null;
  return {
    id: image.id,
    fileName: image.fileName,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    width: image.width,
    height: image.height,
    fingerprint: image.fingerprint,
    alt: image.alt,
    url: imageUrl(image),
    createdAt: image.createdAt.toISOString()
  };
}

function publicationSummary(publication: PublicationRow): PromotionPublicationSummary {
  return {
    id: publication.id,
    number: publication.publicationNumber,
    publishedAt: publication.publishedAt.toISOString(),
    publishedBy: { id: publication.publishedById, name: publication.publishedByName },
    cardVersion: publication.menuVersion ? menuPublishing.versionSummary(publication.menuVersion) : null
  };
}

function snapshotOf(publication: PublicationRow | undefined): PublicPromotion | null {
  const snapshot = publication?.snapshotJson as unknown as PublicPromotion | undefined;
  return snapshot && typeof snapshot === 'object' && typeof snapshot.slug === 'string' ? snapshot : null;
}

/** The card entry of a listing for one version of the card. */
function cardListing(menu: MenuRow, version: { id: string; heading: string }): PublicPromotion['card'] {
  const base = `/api/public/menus/${menu.venue.slug}/${menu.slug}`;
  return {
    slug: menu.slug,
    name: menu.name,
    heading: menuPublishing.menuPrintedHeadingFor(menu, version.heading),
    versionId: version.id,
    pdfUrl: menuPublishing.publicUrl(`/api/public/menus/version/${version.id}.pdf`),
    livePdfUrl: menuPublishing.publicUrl(`${base}.pdf?v=${version.id}`),
    jsonUrl: menuPublishing.publicUrl(`${base}.json?v=${version.id}`)
  };
}

function listingOf(row: PromotionRow, card: PublicPromotion['card'], identity: { publishedAt: string; publicationId: string }): PublicPromotion {
  const image = row.image ? { url: imageUrl(row.image), width: row.image.width, height: row.image.height, alt: row.image.alt } : null;
  return buildPublicPromotion({ slug: row.slug, venue: row.venue, fields: fieldsOf(row), image, card, ...identity });
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function loadPromotion(promotionId: string): Promise<PromotionRow> {
  const row = await prisma.promotion.findUnique({ where: { id: promotionId }, select: PROMOTION_SELECT });
  if (!row) throw new HttpError(404, 'That promotion does not exist.');
  return row;
}

/**
 * What publishing would do to the card: publish its draft, reprint its live
 * version because the promotion's price/when/conditions moved on, nothing
 * (already current), or nothing because it has never been published.
 */
async function loadCard(row: Pick<PromotionRow, 'menuId'>): Promise<CardState | null> {
  if (!row.menuId) return null;
  const menu = await menuPublishing.loadMenu(row.menuId);
  const [published, draft] = await Promise.all([menuPublishing.loadPublished(menu.id), menuPublishing.loadDraft(menu.id)]);
  let action: PromotionCardAction;
  if (menu.status !== 'ACTIVE') action = 'NONE';
  else if (draft) action = 'PUBLISH_DRAFT';
  else if (!published) action = 'UNPUBLISHED';
  else {
    const live = menuPublishing.documentFor(published);
    const overlay = menu.promotion ? promotionCardOverlay(menu.promotion) : null;
    const current =
      !overlay ||
      (live.whenLine === overlay.whenLine && live.heroPriceCents === overlay.heroPriceCents && (live.heroPriceUnit ?? null) === (overlay.heroPriceUnit ?? null) && live.conditions === overlay.conditions);
    action = current ? 'CURRENT' : 'REPUBLISH';
  }
  return { menu, published, draft, action };
}

/** The listing as it would publish right now (the card entry is its live version, if any). */
function currentListing(row: PromotionRow, card: CardState | null): PublicPromotion {
  const entry = card?.published && card.menu.status === 'ACTIVE' ? cardListing(card.menu, { id: card.published.id, heading: menuPublishing.documentFor(card.published).heading }) : null;
  return listingOf(row, entry, { publishedAt: '', publicationId: '' });
}

async function cardSummaries(menuIds: string[]): Promise<Map<string, MenuSummary>> {
  if (menuIds.length === 0) return new Map();
  const summaries = await menuPublishing.summaries({ id: { in: menuIds } });
  return new Map(summaries.map((summary) => [summary.id, summary]));
}

async function summaryOf(row: PromotionRow, cards: Map<string, MenuSummary>, card: CardState | null): Promise<PromotionSummary> {
  const publication = row.publications[0];
  const publishedListing = snapshotOf(publication);
  const listing = currentListing(row, card);
  const listingChanges = publishedListing ? diffPublicPromotions(publishedListing, listing) : [];
  const unpublishedChanges = !publication || listingChanges.length > 0 || card?.action === 'PUBLISH_DRAFT' || card?.action === 'REPUBLISH';
  const fields = fieldsOf(row);
  return {
    id: row.id,
    venue: row.venue,
    slug: row.slug,
    name: row.name,
    publicTitle: row.publicTitle,
    status: statusOf(row),
    sortOrder: row.sortOrder,
    dayLabel: row.dayLabel,
    cadenceLabel: row.cadenceLabel,
    timeLabel: row.timeLabel,
    startsOn: fields.startsOn,
    endsOn: fields.endsOn,
    priceLabel: promotionPriceLabel(fields),
    heroPriceCents: row.heroPriceCents,
    heroPriceUnit: row.heroPriceUnit,
    image: imageSummary(row.image),
    card: row.menuId ? (cards.get(row.menuId) ?? null) : null,
    publication: publication ? publicationSummary(publication) : null,
    unpublishedChanges,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: { id: row.updatedById, name: row.updatedByName }
  };
}

async function detailOf(row: PromotionRow): Promise<PromotionDetail> {
  const card = await loadCard(row);
  const cards = await cardSummaries(row.menuId ? [row.menuId] : []);
  const summary = await summaryOf(row, cards, card);
  const publications = await prisma.promotionPublication.findMany({ where: { promotionId: row.id }, select: PUBLICATION_SELECT, orderBy: { publicationNumber: 'desc' } });
  return {
    ...summary,
    fields: fieldsOf(row),
    listing: currentListing(row, card),
    publishedListing: snapshotOf(row.publications[0]),
    publications: publications.map(publicationSummary)
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function audit(
  tx: Prisma.TransactionClient | typeof prisma,
  input: { promotionId: string; menuId?: string | null; menuVersionId?: string | null; action: string; summary: string; before?: unknown; after?: unknown; actor: Actor }
) {
  await tx.menuAuditEvent.create({
    data: {
      promotionId: input.promotionId,
      menuId: input.menuId ?? null,
      menuVersionId: input.menuVersionId ?? null,
      action: input.action,
      summary: input.summary,
      before: input.before === undefined ? undefined : (input.before as Prisma.InputJsonValue),
      after: input.after === undefined ? undefined : (input.after as Prisma.InputJsonValue),
      actorId: input.actor.id,
      actorName: input.actor.name,
      actorEmail: input.actor.email
    }
  });
}

async function requireNameFree(venueId: string, name: string, exceptId: string | null, client: Prisma.TransactionClient | typeof prisma = prisma) {
  const clash = await client.promotion.findFirst({
    where: { venueId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true }
  });
  if (clash) throw new HttpError(409, `This venue already has a promotion called "${clash.name}". Pick another name.`, { code: 'NAME_TAKEN', promotionId: clash.id });
}

async function freeSlug(venueId: string, name: string, client: Prisma.TransactionClient | typeof prisma): Promise<string> {
  const base = menuSlug(name);
  const taken = new Set((await client.promotion.findMany({ where: { venueId, slug: { startsWith: base } }, select: { slug: true } })).map((row) => row.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  throw new HttpError(409, 'Too many promotions share this name.');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

/** A card may be linked when it is this venue's, a PROMOTION menu, active, and not another promotion's. */
async function requireLinkableCard(menuId: string, venueId: string, exceptPromotionId: string | null): Promise<MenuRow> {
  const menu = await menuPublishing.loadMenu(menuId);
  if (menu.venue.id !== venueId) throw new HttpError(400, `${menu.venue.name} · ${menu.name} belongs to another venue.`);
  if (menu.kind !== 'PROMOTION') throw new HttpError(400, `${menu.name} is a ${menu.kind.toLowerCase().replace('_', ' ')} menu, not a promotion card.`);
  if (menu.status !== 'ACTIVE') throw new HttpError(409, `${menu.name} is archived. Unarchive it from the Menus home before linking it.`, { code: 'MENU_ARCHIVED', menuId: menu.id });
  if (menu.promotion && menu.promotion.id !== exceptPromotionId) throw new HttpError(409, `${menu.name} is already the card for "${menu.promotion.name}".`, { code: 'CARD_TAKEN', promotionId: menu.promotion.id });
  return menu;
}

function checkUpdatedAt(row: PromotionRow, expected: string | undefined) {
  if (!expected) return;
  if (row.updatedAt.toISOString() !== expected) {
    throw new HttpError(409, 'Someone else saved this promotion after you opened it. Reload to see their changes before saving yours.', {
      code: 'STALE_PROMOTION',
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: { id: row.updatedById, name: row.updatedByName }
    });
  }
}

function fieldData(fields: PromotionFields): Prisma.PromotionUncheckedUpdateInput {
  return {
    name: fields.name,
    publicTitle: fields.publicTitle,
    summary: fields.summary,
    dayLabel: fields.dayLabel,
    cadenceLabel: fields.cadenceLabel,
    timeLabel: fields.timeLabel,
    validDays: fields.validDays,
    startTime: fields.startTime,
    startsOn: dateFrom(fields.startsOn),
    endsOn: dateFrom(fields.endsOn),
    heroPriceCents: fields.heroPriceCents,
    heroPriceUnit: fields.heroPriceUnit,
    priceLabel: fields.priceLabel,
    conditions: fields.conditions,
    bookDestination: fields.bookDestination,
    bookLabel: fields.bookLabel,
    bookUrl: fields.bookUrl,
    sortOrder: fields.sortOrder
  };
}

const FIELD_LABELS: Record<keyof PromotionFields, string> = {
  name: 'name',
  publicTitle: 'title',
  summary: 'description',
  dayLabel: 'day label',
  cadenceLabel: 'cadence',
  timeLabel: 'time line',
  validDays: 'weekdays',
  startTime: 'start time',
  startsOn: 'start date',
  endsOn: 'end date',
  heroPriceCents: 'price',
  heroPriceUnit: 'price unit',
  priceLabel: 'price label',
  conditions: 'conditions',
  bookDestination: 'booking button',
  bookLabel: 'booking label',
  bookUrl: 'booking link',
  sortOrder: 'order'
};

function changedFields(before: PromotionFields, after: PromotionFields): Array<keyof PromotionFields> {
  return (Object.keys(FIELD_LABELS) as Array<keyof PromotionFields>).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function decodeImage(dataUrl: string): { mimeType: string; bytes: Buffer } {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
  if (!match) throw new HttpError(400, 'Choose a PNG, JPEG or WebP image.');
  const bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.length === 0) throw new HttpError(400, 'That image is empty.');
  if (bytes.length > PROMOTION_LIMITS.imageBytesMax) {
    throw new HttpError(413, `That image is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. Listing photos are limited to ${PROMOTION_LIMITS.imageBytesMax / 1024 / 1024} MB — export a smaller JPEG.`);
  }
  return { mimeType: match[1]!, bytes };
}

/** What publishing would do with the card, with the menu's own preview when it has to publish. */
async function cardPreview(card: CardState | null): Promise<PromotionPublishPreview['card']> {
  if (!card) return null;
  let preview: MenuPublishPreview | null = null;
  if (card.action === 'PUBLISH_DRAFT') preview = await menuService.publishPreview(card.menu.id);
  else if (card.action === 'REPUBLISH' && card.published) {
    preview = await menuPublishing.previewDocument(card.menu, menuPublishing.withPromotion(card.menu, menuPublishing.stripIds(menuPublishing.documentFor(card.published))), card.published);
  }
  return { menuId: card.menu.id, name: card.menu.name, action: card.action, preview };
}

function listingValidation(row: PromotionRow, card: CardState | null): { errors: PromotionIssue[]; warnings: PromotionIssue[]; ok: boolean } {
  const { errors, warnings } = validatePromotionFields(fieldsOf(row));
  if (card?.action === 'UNPUBLISHED') {
    warnings.push({ level: 'warning', code: 'CARD_UNPUBLISHED', message: `The card "${card.menu.name}" has never been published, so the listing will go out without a menu PDF.` });
  }
  if (card && card.menu.status !== 'ACTIVE') {
    warnings.push({ level: 'warning', code: 'CARD_ARCHIVED', message: `The card "${card.menu.name}" is archived, so the listing will go out without a menu PDF.` });
  }
  if (!row.image) warnings.push({ level: 'warning', code: 'NO_PHOTO', message: 'The listing has no photo.' });
  return { errors, warnings, ok: errors.length === 0 };
}

export const promotionService = {
  // ---------------------------------------------------------------- read
  async list(): Promise<PromotionListPayload> {
    const rows = await prisma.promotion.findMany({ select: PROMOTION_SELECT, orderBy: [{ venue: { name: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }] });
    const cards = await cardSummaries(rows.map((row) => row.menuId).filter((id): id is string => Boolean(id)));
    const summaries: PromotionSummary[] = [];
    for (const row of rows) summaries.push(await summaryOf(row, cards, await loadCard(row)));
    const unlinked = await menuPublishing.summaries({ kind: 'PROMOTION', status: 'ACTIVE', promotion: null });
    return {
      promotions: summaries.filter((promotion) => promotion.status !== 'ENDED'),
      ended: summaries.filter((promotion) => promotion.status === 'ENDED'),
      unlinkedCards: unlinked
    };
  },

  async get(promotionId: string): Promise<PromotionDetail> {
    return detailOf(await loadPromotion(promotionId));
  },

  async listAudit(promotionId: string, limit = 100): Promise<MenuAuditEntry[]> {
    await loadPromotion(promotionId);
    const rows = await prisma.menuAuditEvent.findMany({ where: { promotionId }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 500) });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      summary: row.summary,
      actor: { id: row.actorId, name: row.actorName, email: row.actorEmail },
      menuVersionId: row.menuVersionId,
      createdAt: row.createdAt.toISOString(),
      before: row.before,
      after: row.after
    }));
  },

  // ---------------------------------------------------------------- create / edit
  async create(input: unknown, user: AuthUser | undefined): Promise<PromotionDetail> {
    const data = promotionCreateInputSchema.parse(input);
    const actor = menuActor(user);
    const venue = await prisma.venue.findUnique({ where: { id: data.venueId }, select: { id: true, name: true, slug: true } });
    if (!venue) throw new HttpError(404, 'That venue does not exist.');
    const { venueId: _venueId, menuId: linkMenuId, createCard, ...given } = data;
    const fields = promotionFieldsSchema.parse(given);
    await requireNameFree(venue.id, fields.name, null);

    let menuId: string | null = null;
    if (linkMenuId) menuId = (await requireLinkableCard(linkMenuId, venue.id, null)).id;
    else if (createCard) {
      // The card first, by the menu rules (name clash, template for the kind); the promotion then links it.
      const card = await menuService.createMenu({ venueId: venue.id, name: fields.name, kind: 'PROMOTION', heading: fields.publicTitle || fields.name }, user);
      menuId = card.id;
    }

    let promotionId: string;
    try {
      promotionId = await prisma.$transaction(async (tx) => {
        const slug = await freeSlug(venue.id, fields.name, tx);
        const row = await tx.promotion.create({
          data: { ...(fieldData(fields) as Omit<Prisma.PromotionUncheckedCreateInput, 'venueId' | 'slug'>), venueId: venue.id, slug, menuId, createdById: actor.id, createdByName: actor.name, updatedById: actor.id, updatedByName: actor.name },
          select: { id: true }
        });
        await audit(tx, {
          promotionId: row.id,
          menuId,
          action: 'promotion.created',
          summary: `Created promotion "${fields.name}" for ${venue.name}${menuId ? (createCard ? ' with a new card' : ' linked to an existing card') : ''}.`,
          after: { slug, fields, menuId },
          actor
        });
        return row.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, `This venue already has a promotion called "${fields.name}". Pick another name.`, { code: 'NAME_TAKEN' });
      throw error;
    }
    return this.get(promotionId);
  },

  async update(promotionId: string, input: unknown, user: AuthUser | undefined): Promise<PromotionDetail> {
    const row = await loadPromotion(promotionId);
    const actor = menuActor(user);
    const data = promotionUpdateInputSchema.parse(input);
    checkUpdatedAt(row, data.expectedUpdatedAt);
    const { expectedUpdatedAt: _expected, menuId: linkMenuId, ...given } = data;
    const before = fieldsOf(row);
    const next = promotionFieldsSchema.parse({ ...before, ...Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined)) });
    const changed = changedFields(before, next);
    if (changed.includes('name')) await requireNameFree(row.venueId, next.name, row.id);

    let menuChange: { from: string | null; to: string | null; name: string | null } | null = null;
    if (linkMenuId !== undefined && (linkMenuId ?? null) !== row.menuId) {
      const menu = linkMenuId ? await requireLinkableCard(linkMenuId, row.venueId, row.id) : null;
      menuChange = { from: row.menuId, to: menu?.id ?? null, name: menu?.name ?? null };
    }
    if (changed.length === 0 && !menuChange) return detailOf(row);

    try {
      await prisma.$transaction(async (tx) => {
        const guarded = await tx.promotion.updateMany({
          where: { id: row.id, updatedAt: row.updatedAt },
          data: { ...fieldData(next), ...(menuChange ? { menuId: menuChange.to } : {}), updatedById: actor.id, updatedByName: actor.name }
        });
        if (guarded.count !== 1) throw new HttpError(409, 'Someone else saved this promotion a moment ago. Reload to see their changes before saving yours.', { code: 'STALE_PROMOTION' });
        const lines = changed.map((key) => FIELD_LABELS[key]);
        if (menuChange) lines.push(menuChange.to ? `card linked: ${menuChange.name}` : 'card unlinked');
        await audit(tx, {
          promotionId: row.id,
          menuId: menuChange ? menuChange.to : row.menuId,
          action: 'promotion.saved',
          summary: `Saved promotion: ${lines.join(', ')}.`,
          before: { fields: before, menuId: row.menuId },
          after: { fields: next, menuId: menuChange ? menuChange.to : row.menuId },
          actor
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, `This venue already has a promotion called "${next.name}". Pick another name.`, { code: 'NAME_TAKEN' });
      throw error;
    }
    return this.get(row.id);
  },

  // ---------------------------------------------------------------- photo
  async setImage(promotionId: string, input: unknown, user: AuthUser | undefined): Promise<PromotionDetail> {
    const row = await loadPromotion(promotionId);
    const actor = menuActor(user);
    const data = promotionImageInputSchema.parse(input);
    const { mimeType, bytes } = decodeImage(data.dataUrl);
    const fingerprint = createHash('sha256').update(bytes).digest('hex');
    const size = imageDimensions(bytes, mimeType);
    await prisma.$transaction(async (tx) => {
      // Same bytes already stored (a re-upload, or the other venue's copy of the same photo): reuse the row, the URL is the same.
      const existing = await tx.promotionImage.findUnique({ where: { fingerprint }, select: { id: true } });
      const image = existing
        ? await tx.promotionImage.update({ where: { id: existing.id }, data: { alt: data.alt }, select: { id: true } })
        : await tx.promotionImage.create({
            data: {
              promotionId: row.id,
              fileName: data.fileName,
              mimeType,
              sizeBytes: bytes.length,
              width: size?.width ?? null,
              height: size?.height ?? null,
              fingerprint,
              alt: data.alt,
              data: new Uint8Array(bytes),
              uploadedById: actor.id,
              uploadedByName: actor.name
            },
            select: { id: true }
          });
      await tx.promotion.update({ where: { id: row.id }, data: { imageId: image.id, updatedById: actor.id, updatedByName: actor.name } });
      await audit(tx, {
        promotionId: row.id,
        action: 'promotion.image',
        summary: `${row.imageId ? 'Replaced' : 'Added'} the listing photo (${data.fileName}, ${Math.round(bytes.length / 1024)} KB${size ? `, ${size.width}×${size.height}` : ''}).`,
        after: { fingerprint, fileName: data.fileName, sizeBytes: bytes.length, width: size?.width ?? null, height: size?.height ?? null },
        actor
      });
    });
    return this.get(row.id);
  },

  async removeImage(promotionId: string, user: AuthUser | undefined): Promise<PromotionDetail> {
    const row = await loadPromotion(promotionId);
    const actor = menuActor(user);
    if (!row.imageId) return detailOf(row);
    await prisma.$transaction(async (tx) => {
      await tx.promotion.update({ where: { id: row.id }, data: { imageId: null, updatedById: actor.id, updatedByName: actor.name } });
      await audit(tx, { promotionId: row.id, action: 'promotion.image', summary: 'Removed the listing photo.', before: { fingerprint: row.image?.fingerprint ?? null }, actor });
    });
    return this.get(row.id);
  },

  // ---------------------------------------------------------------- publishing
  /** Everything the publish dialog shows: the listing as it would go out, what changed, and what happens to the card. */
  async publishPreview(promotionId: string): Promise<PromotionPublishPreview> {
    const row = await loadPromotion(promotionId);
    const card = await loadCard(row);
    const validation = listingValidation(row, card);
    const listing = currentListing(row, card);
    const publishedListing = snapshotOf(row.publications[0]);
    const cardPart = await cardPreview(card);
    return {
      validation,
      listing,
      publishedListing,
      listingChanges: diffPublicPromotions(publishedListing, listing),
      card: cardPart,
      canPublish: validation.ok && (cardPart?.preview ? cardPart.preview.canPublish : true)
    };
  },

  /**
   * Publish the listing and, when the card has a draft or prints stale
   * promotion fields, the card too — in one transaction. The card is
   * validated and rendered first by the menu's own rules (preparePublish);
   * a failure there leaves everything as it was and surfaces the menu's
   * error, so a listing is never published against a PDF that disagrees.
   */
  async publish(promotionId: string, input: unknown, user: AuthUser | undefined): Promise<PromotionDetail> {
    const row = await loadPromotion(promotionId);
    const actor = menuActor(user);
    const data = promotionPublishInputSchema.parse(input);
    checkUpdatedAt(row, data.expectedUpdatedAt);
    const card = await loadCard(row);
    const validation = listingValidation(row, card);
    if (validation.errors.length > 0) {
      throw new HttpError(422, `The promotion has ${validation.errors.length} thing${validation.errors.length === 1 ? '' : 's'} to fix before it can be published.`, { code: 'VALIDATION', validation });
    }
    if (validation.warnings.length > 0 && !data.acknowledgeWarnings) {
      throw new HttpError(409, `The promotion has ${validation.warnings.length} warning${validation.warnings.length === 1 ? '' : 's'}. Review them, then publish again to confirm.`, { code: 'WARNINGS', validation });
    }

    // The card's publish, prepared outside the transaction (validation, PDF, fill check), by the menu's rules.
    let prepared: Awaited<ReturnType<typeof menuPublishing.preparePublish>> | null = null;
    if (card && (card.action === 'PUBLISH_DRAFT' || card.action === 'REPUBLISH')) {
      menuPublishing.requireActive(card.menu);
      const doc =
        card.action === 'PUBLISH_DRAFT'
          ? menuPublishing.withPromotion(card.menu, menuPublishing.documentFromRows(card.draft!))
          : menuPublishing.withPromotion(card.menu, menuPublishing.stripIds(menuPublishing.documentFor(card.published!)));
      prepared = await menuPublishing.preparePublish(card.menu, doc, data.acknowledgeWarnings);
    }

    const publishedListing = snapshotOf(row.publications[0]);
    const publicationId = randomUUID();
    await prisma.$transaction(async (tx) => {
      // The promotion row lock serialises publishes and edits of this promotion; the optimistic lock is checked under it.
      const locked = await tx.$queryRaw<Array<{ id: string; updatedAt: Date }>>`SELECT "id", "updatedAt" FROM "Promotion" WHERE "id" = ${row.id} FOR UPDATE`;
      if (locked[0]?.updatedAt.getTime() !== row.updatedAt.getTime()) {
        throw new HttpError(409, 'This promotion changed while it was being published. Reload, check the preview, and publish again.', { code: 'STALE_PROMOTION' });
      }

      let cardEntry: PublicPromotion['card'] = null;
      let cardVersionId: string | null = null;
      let cardNote = '';
      if (card && prepared) {
        await menuPublishing.lockActiveMenu(tx, card.menu);
        const draft =
          card.action === 'PUBLISH_DRAFT'
            ? { id: card.draft!.id, versionNumber: card.draft!.versionNumber, updatedAt: card.draft!.updatedAt }
            : await menuPublishing.createDraftRows(tx, card.menu, actor, prepared.doc, (n) => `Started draft v${n} from published v${card.published!.versionNumber} to reprint "${row.name}" with its current price, times and conditions.`);
        const committed = await menuPublishing.commitPublish(tx, card.menu, draft, prepared, actor);
        cardVersionId = committed.versionId;
        cardEntry = cardListing(card.menu, { id: committed.versionId, heading: prepared.doc.heading });
        cardNote = ` Card "${card.menu.name}" v${committed.versionNumber} published.`;
      } else if (card?.published && card.menu.status === 'ACTIVE') {
        cardVersionId = card.published.id;
        cardEntry = cardListing(card.menu, { id: card.published.id, heading: menuPublishing.documentFor(card.published).heading });
      }

      const publishedAt = new Date();
      const last = await tx.promotionPublication.aggregate({ where: { promotionId: row.id }, _max: { publicationNumber: true } });
      const number = (last._max.publicationNumber ?? 0) + 1;
      const listing = listingOf(row, cardEntry, { publishedAt: publishedAt.toISOString(), publicationId });
      await tx.promotionPublication.create({
        data: {
          id: publicationId,
          promotionId: row.id,
          publicationNumber: number,
          snapshotJson: listing as unknown as Prisma.InputJsonValue,
          menuVersionId: cardVersionId,
          publishedAt,
          publishedById: actor.id,
          publishedByName: actor.name
        }
      });
      await tx.promotion.update({ where: { id: row.id }, data: { status: 'PUBLISHED', updatedById: actor.id, updatedByName: actor.name } });
      const changes = diffPublicPromotions(publishedListing, listing);
      await audit(tx, {
        promotionId: row.id,
        menuId: card?.menu.id ?? null,
        menuVersionId: cardVersionId,
        action: 'promotion.published',
        summary: `Published listing #${number}${row.status !== 'PUBLISHED' ? ` (was ${row.status.toLowerCase()})` : ''}: ${changes.join(', ') || 'no listing changes'}.${cardNote}${
          validation.warnings.length ? ` ${validation.warnings.length} warning${validation.warnings.length === 1 ? '' : 's'} acknowledged.` : ''
        }`,
        before: publishedListing,
        after: listing,
        actor
      });
    });
    return this.get(row.id);
  },

  /** Hide (off the website, publication kept), show again, or end a promotion. */
  async setStatus(promotionId: string, action: 'hide' | 'show' | 'end', user: AuthUser | undefined): Promise<PromotionDetail> {
    const row = await loadPromotion(promotionId);
    const actor = menuActor(user);
    const from = statusOf(row);
    let to: PromotionStatus;
    if (action === 'hide') {
      if (from !== 'PUBLISHED') throw new HttpError(409, `"${row.name}" is not live, so there is nothing to hide.`);
      to = 'HIDDEN';
    } else if (action === 'show') {
      if (from === 'PUBLISHED') return detailOf(row);
      if (row.publications.length === 0) throw new HttpError(409, `"${row.name}" has never been published. Publish it to put it on the website.`, { code: 'NOT_PUBLISHED' });
      to = 'PUBLISHED';
    } else {
      if (from === 'ENDED') return detailOf(row);
      to = 'ENDED';
    }
    await prisma.$transaction(async (tx) => {
      await tx.promotion.update({ where: { id: row.id }, data: { status: to, updatedById: actor.id, updatedByName: actor.name } });
      await audit(tx, {
        promotionId: row.id,
        menuId: row.menuId,
        action: `promotion.${action === 'show' ? 'shown' : action === 'hide' ? 'hidden' : 'ended'}`,
        summary: action === 'hide' ? 'Hidden from the website (the last publication is kept).' : action === 'show' ? 'Shown on the website again (the last publication).' : 'Ended.',
        before: { status: from },
        after: { status: to },
        actor
      });
    });
    return this.get(row.id);
  },

  // ---------------------------------------------------------------- public (website)
  /** The latest publication of every live promotion running today, both venues or one. */
  async whatsOn(venueSlug: string | null): Promise<PublicWhatsOn> {
    if (venueSlug) {
      const venue = await prisma.venue.findUnique({ where: { slug: venueSlug }, select: { id: true } });
      if (!venue) throw new HttpError(404, 'No such venue.');
    }
    const rows = await prisma.promotion.findMany({
      where: { status: 'PUBLISHED', ...(venueSlug ? { venue: { slug: venueSlug } } : {}) },
      select: { id: true, sortOrder: true, venue: { select: { name: true, slug: true } }, publications: { select: { snapshotJson: true }, orderBy: { publicationNumber: 'desc' as const }, take: 1 } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
    });
    const today = venueToday();
    const promotions: PublicPromotion[] = [];
    const venues = new Map<string, { name: string; slug: string }>();
    for (const row of rows) {
      const snapshot = row.publications[0]?.snapshotJson as unknown as PublicPromotion | undefined;
      if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.slug !== 'string') continue;
      if (!promotionRunsOn(snapshot, today)) continue;
      promotions.push(snapshot);
      venues.set(row.venue.slug, row.venue);
    }
    return { venues: Array.from(venues.values()), promotions, generatedAt: new Date().toISOString() };
  },

  /** A listing photo by content hash — immutable, so the website may cache it forever. */
  async publicImage(fingerprint: string): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new HttpError(404, 'No such image.');
    const image = await prisma.promotionImage.findUnique({ where: { fingerprint }, select: { data: true, mimeType: true, fileName: true } });
    if (!image) throw new HttpError(404, 'No such image.');
    return { bytes: Buffer.from(image.data), mimeType: image.mimeType, fileName: image.fileName };
  }
};
