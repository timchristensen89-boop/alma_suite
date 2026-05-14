import { prisma } from '@alma/db';
import { Prisma } from '@prisma/client';
import {
  marketingAutomationInputSchema,
  marketingAutomationUpdateInputSchema,
  marketingCampaignInputSchema,
  marketingCampaignUpdateInputSchema,
  marketingChannelSchema,
  marketingContentAssetInputSchema,
  marketingContentAssetUpdateInputSchema,
  marketingContentPostAssetInputSchema,
  marketingContentPostInputSchema,
  marketingContentPostUpdateInputSchema,
  marketingContentScheduleInputSchema,
  marketingSocialAccountInputSchema,
  marketingSocialAccountUpdateInputSchema,
  marketingSegmentDefinitionSchema,
  marketingSegmentInputSchema,
  marketingSegmentPreviewInputSchema,
  marketingTagInputSchema,
  marketingTagUpdateInputSchema,
  marketingTemplateInputSchema,
  marketingTemplateUpdateInputSchema,
  type AuthUser,
  type GuestTimelinePayload,
  type MarketingChannel,
  type MarketingContentHelper,
  type MarketingSegmentDefinition,
  type ReserveGuest,
  type SocialPlatform
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

const BIG_SPENDER_THRESHOLD_CENTS = 50_000;
const LAPSED_DAYS = 90;
const BIRTHDAY_SOON_DAYS = 30;
const EMPTY_SEGMENT_DEFINITION = marketingSegmentDefinitionSchema.parse({});

const CONTENT_HELPERS: MarketingContentHelper[] = [
  {
    id: 'book-now',
    label: 'Book now',
    contentPillar: 'bookings',
    caption: 'Tables are open this week at {{venueName}}. Book your spot and make a night of it.',
    targetChannels: ['FACEBOOK', 'INSTAGRAM'],
    campaignSubject: 'Your next table at {{venueName}}',
    campaignPreviewText: 'Reserve a table for this week.',
    campaignBody: '<h1>Hi {{firstName}}</h1><p>Tables are open at {{venueName}}. We would love to see you soon.</p><p><a href="{{bookingLink}}">Book a table</a></p>'
  },
  {
    id: 'gift-cards',
    label: 'Gift cards',
    contentPillar: 'gift_cards',
    caption: 'An Alma gift card is ready when you need a thoughtful last-minute present.',
    targetChannels: ['FACEBOOK', 'INSTAGRAM'],
    campaignSubject: 'A little Alma gift',
    campaignPreviewText: 'Gift cards are available for the next celebration.',
    campaignBody: '<h1>Hi {{firstName}}</h1><p>Gift cards are available for Alma venues and make an easy table-ready present.</p>'
  },
  {
    id: 'function-enquiry',
    label: 'Function enquiry',
    contentPillar: 'functions',
    caption: 'Planning a group lunch, dinner, or celebration? Talk to our team about functions at {{venueName}}.',
    targetChannels: ['FACEBOOK', 'INSTAGRAM'],
    campaignSubject: 'Plan your next function at {{venueName}}',
    campaignPreviewText: 'Group dining and events at Alma.',
    campaignBody: '<h1>Hi {{firstName}}</h1><p>Planning a group event? Our team can help with functions at {{venueName}}.</p>'
  },
  {
    id: 'weekend-special',
    label: 'Weekend special',
    contentPillar: 'food',
    caption: 'Weekend specials are on. Bring a few friends and settle in at {{venueName}}.',
    targetChannels: ['FACEBOOK', 'INSTAGRAM', 'TIKTOK'],
    campaignSubject: 'Weekend specials at {{venueName}}',
    campaignPreviewText: 'A reason to book this weekend.',
    campaignBody: '<h1>Hi {{firstName}}</h1><p>Weekend specials are on at {{venueName}}. Book a table and make a night of it.</p><p><a href="{{bookingLink}}">Book now</a></p>'
  },
  {
    id: 'new-menu-item',
    label: 'New menu item',
    contentPillar: 'food',
    caption: 'New on the menu at {{venueName}}. Come in and try it while it is fresh.',
    targetChannels: ['FACEBOOK', 'INSTAGRAM', 'TIKTOK'],
    campaignSubject: 'New on the menu',
    campaignPreviewText: 'Try something new at Alma.',
    campaignBody: '<h1>Hi {{firstName}}</h1><p>There is something new on the menu at {{venueName}}.</p>'
  },
  {
    id: 'event-night',
    label: 'Event night',
    contentPillar: 'events',
    caption: 'Event night is coming up at {{venueName}}. Book early so you do not miss a table.',
    targetChannels: ['FACEBOOK', 'INSTAGRAM'],
    campaignSubject: 'Event night at {{venueName}}',
    campaignPreviewText: 'Book ahead for the next Alma event.',
    campaignBody: '<h1>Hi {{firstName}}</h1><p>Event night is coming up at {{venueName}}. Reserve ahead to secure a table.</p><p><a href="{{bookingLink}}">Book now</a></p>'
  },
  {
    id: 'cocktail-feature',
    label: 'Margarita or cocktail feature',
    contentPillar: 'drinks',
    caption: 'Cocktail feature of the week at {{venueName}}. A good excuse to start with a margarita.',
    targetChannels: ['FACEBOOK', 'INSTAGRAM', 'TIKTOK'],
    campaignSubject: 'Cocktail feature at {{venueName}}',
    campaignPreviewText: 'Start with a margarita.',
    campaignBody: '<h1>Hi {{firstName}}</h1><p>Our cocktail feature is pouring this week at {{venueName}}.</p>'
  },
  {
    id: 'staff-spotlight',
    label: 'Staff spotlight',
    contentPillar: 'staff',
    caption: 'Meet one of the people who makes service feel like Alma.',
    targetChannels: ['FACEBOOK', 'INSTAGRAM'],
    campaignSubject: 'Meet the Alma team',
    campaignPreviewText: 'A little behind the scenes from the venue.',
    campaignBody: '<h1>Hi {{firstName}}</h1><p>Meet one of the people behind service at {{venueName}}.</p>'
  }
];

const AUTO_TAGS = [
  { slug: 'repeat_visitor', name: 'Repeat visitor', type: 'AUTOMATIC' as const },
  { slug: 'first_timer', name: 'First timer', type: 'AUTOMATIC' as const },
  { slug: 'big_spender', name: 'Big spender', type: 'AUTOMATIC' as const },
  { slug: 'lapsed_guest', name: 'Lapsed guest', type: 'AUTOMATIC' as const },
  { slug: 'vip', name: 'VIP', type: 'SYSTEM' as const },
  { slug: 'birthday_soon', name: 'Birthday soon', type: 'AUTOMATIC' as const },
  { slug: 'no_show_risk', name: 'No-show risk', type: 'AUTOMATIC' as const }
];

const guestWithTagsArgs = Prisma.validator<Prisma.ReserveGuestDefaultArgs>()({
  include: {
    tagAssignments: {
      include: { tag: true },
      orderBy: { assignedAt: 'desc' }
    }
  }
});

const campaignWithRecipientsArgs = Prisma.validator<Prisma.MarketingCampaignDefaultArgs>()({
  include: {
    recipients: {
      include: {
        contact: true,
        guest: {
          include: guestWithTagsArgs.include
        }
      },
      orderBy: { createdAt: 'desc' }
    }
  }
});

const automationWithTemplateArgs = Prisma.validator<Prisma.MarketingAutomationDefaultArgs>()({
  include: { emailTemplate: true }
});

type GuestRow = Prisma.ReserveGuestGetPayload<typeof guestWithTagsArgs>;
type CampaignRow = Prisma.MarketingCampaignGetPayload<typeof campaignWithRecipientsArgs>;
type TemplateRow = Prisma.MarketingEmailTemplateGetPayload<Record<string, never>>;
type TagRow = Prisma.GuestTagGetPayload<Record<string, never>>;
type AutomationRow = Prisma.MarketingAutomationGetPayload<typeof automationWithTemplateArgs>;

const contentAssetWithRelationsArgs = Prisma.validator<Prisma.MarketingContentAssetDefaultArgs>()({});
const contentPostWithRelationsArgs = Prisma.validator<Prisma.MarketingContentPostDefaultArgs>()({
  include: {
    assets: {
      include: { asset: true },
      orderBy: { sortOrder: 'asc' }
    }
  }
});

type ContentAssetRow = Prisma.MarketingContentAssetGetPayload<typeof contentAssetWithRelationsArgs>;
type ContentPostRow = Prisma.MarketingContentPostGetPayload<typeof contentPostWithRelationsArgs>;
type SocialAccountRow = Prisma.MarketingSocialAccountGetPayload<Record<string, never>>;
type PublishAttemptRow = Prisma.MarketingContentPublishAttemptGetPayload<Record<string, never>>;

function isAdminActor(actor?: AuthUser | null) {
  return Boolean(actor?.isAdmin || actor?.role === 'ADMIN');
}

function actorVenueScope(actor?: AuthUser | null, requestedVenue?: string | null, product = 'Marketing') {
  const venue = requestedVenue?.trim() || null;
  if (!actor || isAdminActor(actor)) return venue;
  if (!actor.venue) throw new HttpError(403, `${product} requires a venue-scoped manager profile.`);
  if (venue && venue !== actor.venue) {
    throw new HttpError(403, `${product} is limited to your venue.`);
  }
  return actor.venue;
}

function cleanText(value?: string | null) {
  return value?.trim() || null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trim()}...`;
}

function jsonStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function jsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseOptionalDate(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, 'Date is invalid');
  return parsed;
}

function parseRequiredDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, 'Date is invalid');
  return parsed;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function tagSlugForVenue(baseSlug: string, venue?: string | null) {
  return venue ? `${slugify(venue)}-${baseSlug}` : baseSlug;
}

function guestInclude() {
  return guestWithTagsArgs.include;
}

function segmentDefinitionFromJson(value: Prisma.JsonValue | null | undefined): MarketingSegmentDefinition {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      ...EMPTY_SEGMENT_DEFINITION,
      ...(value as Record<string, unknown>)
    } as MarketingSegmentDefinition;
  }

  return EMPTY_SEGMENT_DEFINITION;
}

function guestScope(actor?: AuthUser | null, requestedVenue?: string | null): Prisma.ReserveGuestWhereInput {
  const venue = actorVenueScope(actor, requestedVenue, 'Marketing');
  if (!venue) return {};
  return {
    OR: [{ venue }, { reservations: { some: { venue } } }]
  };
}

function guestToPayload(guest: GuestRow): ReserveGuest {
  return {
    id: guest.id,
    venue: guest.venue,
    firstName: guest.firstName,
    lastName: guest.lastName,
    email: guest.email,
    phone: guest.phone,
    birthday: guest.birthday?.toISOString() ?? null,
    tags: guest.tags,
    allergyNotes: guest.allergyNotes,
    visitNotes: guest.visitNotes,
    notes: guest.notes,
    preferences:
      guest.preferences && typeof guest.preferences === 'object' && !Array.isArray(guest.preferences)
        ? (guest.preferences as Record<string, unknown>)
        : {},
    dietaryNotes: guest.dietaryNotes,
    marketingOptIn: guest.marketingOptIn,
    emailUnsubscribedAt: guest.emailUnsubscribedAt?.toISOString() ?? null,
    smsUnsubscribedAt: guest.smsUnsubscribedAt?.toISOString() ?? null,
    source: guest.source,
    totalVisits: guest.totalVisits,
    totalSpendCents: guest.totalSpendCents,
    noShowCount: guest.noShowCount,
    lastVisitAt: guest.lastVisitAt?.toISOString() ?? null,
    firstVisitAt: guest.firstVisitAt?.toISOString() ?? null,
    createdAt: guest.createdAt.toISOString(),
    updatedAt: guest.updatedAt.toISOString(),
    tagAssignments: guest.tagAssignments.map((assignment) => ({
      id: assignment.id,
      guestId: assignment.guestId,
      tagId: assignment.tagId,
      source: assignment.source,
      assignedAt: assignment.assignedAt.toISOString(),
      assignedByStaffId: assignment.assignedByStaffId,
      metadata:
        assignment.metadata && typeof assignment.metadata === 'object' && !Array.isArray(assignment.metadata)
          ? (assignment.metadata as Record<string, unknown>)
          : {},
      tag: {
        id: assignment.tag.id,
        venue: assignment.tag.venue,
        name: assignment.tag.name,
        slug: assignment.tag.slug,
        description: assignment.tag.description,
        type: assignment.tag.type,
        color: assignment.tag.color,
        ruleDefinition: segmentDefinitionFromJson(assignment.tag.ruleDefinition),
        active: assignment.tag.active,
        createdAt: assignment.tag.createdAt.toISOString(),
        updatedAt: assignment.tag.updatedAt.toISOString()
      }
    }))
  };
}

function tagToPayload(tag: TagRow) {
  return {
    id: tag.id,
    venue: tag.venue,
    name: tag.name,
    slug: tag.slug,
    description: tag.description,
    type: tag.type,
    color: tag.color,
    ruleDefinition: segmentDefinitionFromJson(tag.ruleDefinition),
    active: tag.active,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString()
  };
}

function templateToPayload(template: TemplateRow) {
  return {
    id: template.id,
    venue: template.venue,
    name: template.name,
    subject: template.subject,
    previewText: template.previewText,
    htmlBody: template.htmlBody,
    textBody: template.textBody,
    status: template.status,
    createdByStaffId: template.createdByStaffId,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString()
  };
}

function automationToPayload(automation: AutomationRow) {
  return {
    id: automation.id,
    venue: automation.venue,
    name: automation.name,
    triggerType: automation.triggerType,
    segmentDefinition: segmentDefinitionFromJson(automation.segmentDefinition),
    emailTemplateId: automation.emailTemplateId,
    delayHours: automation.delayHours,
    active: automation.active,
    createdAt: automation.createdAt.toISOString(),
    updatedAt: automation.updatedAt.toISOString(),
    emailTemplate: automation.emailTemplate ? templateToPayload(automation.emailTemplate) : null
  };
}

function campaignToPayload(campaign: CampaignRow) {
  return {
    id: campaign.id,
    venue: campaign.venue,
    name: campaign.name,
    channel: campaign.channel,
    status: campaign.status,
    audienceName: campaign.audienceName,
    subject: campaign.subject,
    previewText: campaign.previewText,
    body: campaign.body,
    textBody: campaign.textBody,
    segmentDefinition: segmentDefinitionFromJson(campaign.segmentDefinition),
    scheduledFor: campaign.scheduledFor?.toISOString() ?? null,
    sentAt: campaign.sentAt?.toISOString() ?? null,
    simulatedAt: campaign.simulatedAt?.toISOString() ?? null,
    createdById: campaign.createdById,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
    recipients: campaign.recipients.map((recipient) => ({
      id: recipient.id,
      campaignId: recipient.campaignId,
      contactId: recipient.contactId,
      guestId: recipient.guestId,
      email: recipient.email,
      status: recipient.status,
      skipReason: recipient.skipReason,
      sentAt: recipient.sentAt?.toISOString() ?? null,
      openedAt: recipient.openedAt?.toISOString() ?? null,
      clickedAt: recipient.clickedAt?.toISOString() ?? null,
      error: recipient.error,
      createdAt: recipient.createdAt.toISOString(),
      contact: {
        id: recipient.contact.id,
        firstName: recipient.contact.firstName,
        lastName: recipient.contact.lastName,
        email: recipient.contact.email,
        phone: recipient.contact.phone,
        venue: recipient.contact.venue,
        source: recipient.contact.source,
        tags: recipient.contact.tags,
        consentEmail: recipient.contact.consentEmail,
        consentSms: recipient.contact.consentSms,
        totalVisits: recipient.contact.totalVisits,
        lastVisitAt: recipient.contact.lastVisitAt?.toISOString() ?? null,
        allergyNotes: recipient.contact.allergyNotes,
        notes: recipient.contact.notes,
        reserveGuestId: recipient.contact.reserveGuestId,
        createdAt: recipient.contact.createdAt.toISOString(),
        updatedAt: recipient.contact.updatedAt.toISOString()
      },
      guest: recipient.guest ? guestToPayload(recipient.guest as GuestRow) : null
    }))
  };
}

function contentAssetToPayload(asset: ContentAssetRow) {
  return {
    id: asset.id,
    venue: asset.venue,
    uploadedByStaffId: asset.uploadedByStaffId,
    title: asset.title,
    description: asset.description,
    assetType: asset.assetType,
    mimeType: asset.mimeType,
    fileName: asset.fileName,
    fileSizeBytes: asset.fileSizeBytes,
    storageProvider: asset.storageProvider,
    storagePath: asset.storagePath,
    publicUrl: asset.publicUrl,
    thumbnailUrl: asset.thumbnailUrl,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    status: asset.status,
    tags: jsonStringArray(asset.tags),
    source: asset.source,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString()
  };
}

function contentPostToPayload(post: ContentPostRow) {
  return {
    id: post.id,
    venue: post.venue,
    createdByStaffId: post.createdByStaffId,
    title: post.title,
    caption: post.caption,
    status: post.status,
    scheduledAt: post.scheduledAt?.toISOString() ?? null,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    campaignId: post.campaignId,
    targetChannels: jsonStringArray(post.targetChannels) as SocialPlatform[],
    contentPillar: post.contentPillar,
    approvalRequired: post.approvalRequired,
    approvedByStaffId: post.approvedByStaffId,
    approvedAt: post.approvedAt?.toISOString() ?? null,
    failureReason: post.failureReason,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    assets: post.assets.map((link) => ({
      id: link.id,
      postId: link.postId,
      assetId: link.assetId,
      sortOrder: link.sortOrder,
      createdAt: link.createdAt.toISOString(),
      asset: contentAssetToPayload(link.asset)
    }))
  };
}

function socialAccountToPayload(account: SocialAccountRow) {
  return {
    id: account.id,
    venue: account.venue,
    platform: account.platform,
    displayName: account.displayName,
    handle: account.handle,
    externalAccountId: account.externalAccountId,
    status: account.status,
    scopes: jsonStringArray(account.scopes),
    hasTokenSecretRef: Boolean(account.tokenSecretRef),
    lastConnectedAt: account.lastConnectedAt?.toISOString() ?? null,
    lastError: account.lastError,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString()
  };
}

function publishAttemptToPayload(attempt: PublishAttemptRow) {
  return {
    id: attempt.id,
    postId: attempt.postId,
    platform: attempt.platform,
    socialAccountId: attempt.socialAccountId,
    status: attempt.status,
    mode: attempt.mode,
    requestPreview: jsonObject(attempt.requestPreview),
    responsePreview: jsonObject(attempt.responsePreview),
    errorMessage: attempt.errorMessage,
    createdAt: attempt.createdAt.toISOString(),
    processedAt: attempt.processedAt?.toISOString() ?? null
  };
}

async function ensureMarketingContact(tx: Prisma.TransactionClient, guest: GuestRow) {
  const data = {
    firstName: guest.firstName,
    lastName: guest.lastName,
    email: guest.email,
    phone: guest.phone,
    venue: guest.venue,
    source: guest.source || 'reserve',
    tags: guest.tags,
    consentEmail: Boolean(guest.marketingOptIn && guest.email && !guest.emailUnsubscribedAt),
    consentSms: Boolean(guest.marketingOptIn && guest.phone && !guest.smsUnsubscribedAt),
    totalVisits: guest.totalVisits,
    lastVisitAt: guest.lastVisitAt,
    allergyNotes: guest.dietaryNotes ?? guest.allergyNotes,
    notes: guest.notes ?? guest.visitNotes,
    reserveGuestId: guest.id
  };
  return tx.marketingContact.upsert({
    where: { reserveGuestId: guest.id },
    create: data,
    update: data
  });
}

async function ensureVenueSystemTags(tx: Prisma.TransactionClient, venue: string) {
  const existing = await tx.guestTag.findMany({
    where: {
      venue,
      slug: { in: AUTO_TAGS.map((tag) => tagSlugForVenue(tag.slug, venue)) }
    }
  });
  const existingSlugs = new Set(existing.map((tag) => tag.slug));
  for (const tag of AUTO_TAGS) {
    const slug = tagSlugForVenue(tag.slug, venue);
    if (existingSlugs.has(slug)) continue;
    await tx.guestTag.create({
      data: {
        venue,
        name: tag.name,
        slug,
        description: `${tag.name} auto-tag for ${venue}.`,
        type: tag.type,
        active: true,
        ruleDefinition: EMPTY_SEGMENT_DEFINITION as Prisma.InputJsonValue
      }
    });
  }
}

function birthdayWithinDays(birthday: Date | null, days: number) {
  if (!birthday) return false;
  const now = new Date();
  const thisYear = new Date(now.getFullYear(), birthday.getMonth(), birthday.getDate());
  const nextBirthday = thisYear < now ? new Date(now.getFullYear() + 1, birthday.getMonth(), birthday.getDate()) : thisYear;
  const diffDays = Math.ceil((nextBirthday.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  return diffDays >= 0 && diffDays <= days;
}

export async function recalculateAutoTagsForGuest(guestId: string) {
  return prisma.$transaction(async (tx) => {
    const guest = await tx.reserveGuest.findUnique({
      where: { id: guestId },
      include: guestInclude()
    });
    if (!guest) throw new HttpError(404, 'Guest not found');
    if (!guest.venue) return { guestId, venue: null, assigned: 0, removed: 0 };

    await ensureVenueSystemTags(tx, guest.venue);
    const tags = await tx.guestTag.findMany({
      where: {
        venue: guest.venue,
        slug: { in: AUTO_TAGS.map((tag) => tagSlugForVenue(tag.slug, guest.venue)) }
      }
    });
    const byBaseSlug = new Map(tags.map((tag) => [tag.slug.replace(`${slugify(guest.venue!)}-`, ''), tag]));

    const desired = new Set<string>();
    if (guest.totalVisits <= 1) desired.add('first_timer');
    if (guest.totalVisits >= 2) desired.add('repeat_visitor');
    if (guest.totalSpendCents >= BIG_SPENDER_THRESHOLD_CENTS) desired.add('big_spender');
    if (guest.lastVisitAt && guest.lastVisitAt.getTime() < Date.now() - LAPSED_DAYS * 24 * 60 * 60 * 1000) desired.add('lapsed_guest');
    if (birthdayWithinDays(guest.birthday, BIRTHDAY_SOON_DAYS)) desired.add('birthday_soon');
    if (guest.noShowCount >= 2) desired.add('no_show_risk');

    const existingAutomaticAssignments = guest.tagAssignments.filter(
      (assignment) =>
        assignment.source === 'AUTOMATIC' &&
        assignment.tag.venue === guest.venue &&
        ['AUTOMATIC', 'SYSTEM'].includes(assignment.tag.type)
    );

    let assigned = 0;
    let removed = 0;

    for (const assignment of existingAutomaticAssignments) {
      const baseSlug = assignment.tag.slug.replace(`${slugify(guest.venue)}-`, '');
      if (!desired.has(baseSlug)) {
        await tx.guestTagAssignment.delete({ where: { id: assignment.id } });
        removed += 1;
      }
    }

    for (const slug of desired) {
      const tag = byBaseSlug.get(slug);
      if (!tag) continue;
      const exists = guest.tagAssignments.some((assignment) => assignment.tagId === tag.id);
      if (exists) continue;
      await tx.guestTagAssignment.create({
        data: {
          guestId: guest.id,
          tagId: tag.id,
          source: 'AUTOMATIC',
          metadata: { reason: slug } as Prisma.InputJsonValue
        }
      });
      assigned += 1;
    }

    const refreshedAssignments = await tx.guestTagAssignment.findMany({
      where: { guestId: guest.id },
      include: { tag: true },
      orderBy: { assignedAt: 'desc' }
    });

    await tx.reserveGuest.update({
      where: { id: guest.id },
      data: {
        tags: refreshedAssignments.filter((assignment) => assignment.tag.active).map((assignment) => assignment.tag.name)
      }
    });

    return { guestId: guest.id, venue: guest.venue, assigned, removed };
  });
}

async function recalculateAutoTagsForGuests(guestIds: string[]) {
  let assigned = 0;
  let removed = 0;
  for (const guestId of guestIds) {
    const result = await recalculateAutoTagsForGuest(guestId);
    assigned += result.assigned;
    removed += result.removed;
  }
  return { guests: guestIds.length, assigned, removed };
}

function renderMergeFields(template: string, guest: GuestRow, venueName: string) {
  const firstName = guest.firstName || 'guest';
  const bookingLink = `${process.env.RESERVE_WEB_URL ?? 'http://localhost:5177'}/widget?venue=${encodeURIComponent(venueName)}`;
  const unsubscribeLink = `${process.env.MARKETING_WEB_URL ?? 'http://localhost:5178'}/preferences?guest=${guest.id}`;
  return template
    .replace(/\{\{\s*firstName\s*\}\}/gi, firstName)
    .replace(/\{\{\s*venueName\s*\}\}/gi, venueName)
    .replace(/\{\{\s*bookingLink\s*\}\}/gi, bookingLink)
    .replace(/\{\{\s*unsubscribeLink\s*\}\}/gi, unsubscribeLink);
}

function recipientStatusForGuest(guest: GuestRow, channel: MarketingChannel) {
  if (channel === 'EMAIL') {
    if (!guest.email) return { status: 'SKIPPED', skipReason: 'missing_email' };
    if (guest.emailUnsubscribedAt) return { status: 'SKIPPED', skipReason: 'email_unsubscribed' };
    if (!guest.marketingOptIn) return { status: 'SKIPPED', skipReason: 'marketing_opt_out' };
    return { status: 'PENDING', skipReason: null };
  }

  if (!guest.phone) return { status: 'SKIPPED', skipReason: 'missing_phone' };
  if (guest.smsUnsubscribedAt) return { status: 'SKIPPED', skipReason: 'sms_unsubscribed' };
  if (!guest.marketingOptIn) return { status: 'SKIPPED', skipReason: 'marketing_opt_out' };
  return { status: 'PENDING', skipReason: null };
}

async function loadGuestsForSegment(
  actor: AuthUser,
  definition: MarketingSegmentDefinition,
  fallbackVenue?: string | null
) {
  const venue = actorVenueScope(actor, definition.venue || fallbackVenue || null, 'Marketing');
  const now = new Date();
  const lastVisitOlderThanDays = definition.lastVisitOlderThanDays ?? definition.maxDaysSinceVisit;
  const lastVisitWithinDays = definition.lastVisitWithinDays;
  const lastVisitAt: Prisma.DateTimeNullableFilter | undefined =
    lastVisitOlderThanDays !== undefined || lastVisitWithinDays !== undefined
      ? {
          ...(lastVisitOlderThanDays !== undefined
            ? { lte: new Date(now.getTime() - lastVisitOlderThanDays * 24 * 60 * 60 * 1000) }
            : {}),
          ...(lastVisitWithinDays !== undefined
            ? { gte: new Date(now.getTime() - lastVisitWithinDays * 24 * 60 * 60 * 1000) }
            : {})
        }
      : undefined;
  const baseWhere: Prisma.ReserveGuestWhereInput = {
    ...guestScope(actor, venue),
    ...(definition.guestIds.length > 0 ? { id: { in: definition.guestIds } } : {}),
    ...(definition.tagIds.length > 0 ? { tagAssignments: { some: { tagId: { in: definition.tagIds } } } } : {}),
    ...(definition.excludedTagIds.length > 0 ? { NOT: { tagAssignments: { some: { tagId: { in: definition.excludedTagIds } } } } } : {}),
    ...(definition.minVisits !== undefined ? { totalVisits: { gte: definition.minVisits } } : {}),
    ...(definition.maxVisits !== undefined ? { totalVisits: { lte: definition.maxVisits } } : {}),
    ...(definition.minSpendCents !== undefined ? { totalSpendCents: { gte: definition.minSpendCents } } : {}),
    ...(lastVisitAt ? { lastVisitAt } : {}),
    ...(definition.hasUpcomingReservation === true
      ? {
          reservations: {
            some: {
              startsAt: { gte: now },
              status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
              ...(venue ? { venue } : {})
            }
          }
        }
      : {}),
    ...(definition.hasUpcomingReservation === false
      ? {
          reservations: {
            none: {
              startsAt: { gte: now },
              status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] },
              ...(venue ? { venue } : {})
            }
          }
        }
      : {})
  };

  const search = cleanText(definition.search);
  const guests = await prisma.reserveGuest.findMany({
    where: {
      ...baseWhere,
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } }
            ]
          }
        : {}),
      ...(definition.marketingOptInOnly ? { marketingOptIn: true } : {})
    },
    include: guestInclude(),
    orderBy: [{ lastVisitAt: 'desc' }, { updatedAt: 'desc' }],
    take: 500
  });

  let filteredGuests = guests.filter((guest) => {
    if (definition.birthdaysWithinDays && !birthdayWithinDays(guest.birthday, definition.birthdaysWithinDays)) {
      return false;
    }
    return true;
  });

  if (definition.hasGiftCardPurchase !== undefined) {
    const emails = Array.from(
      new Set(
        filteredGuests
          .flatMap((guest) => [guest.email?.trim().toLowerCase()].filter((email): email is string => Boolean(email)))
      )
    );
    const giftCardEmails = emails.length
      ? await prisma.giftCard.findMany({
          where: {
            OR: [{ purchaserEmail: { in: emails } }, { recipientEmail: { in: emails } }],
            status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'REDEEMED'] }
          },
          select: { purchaserEmail: true, recipientEmail: true }
        })
      : [];
    const emailSet = new Set(
      giftCardEmails.flatMap((card) =>
        [card.purchaserEmail, card.recipientEmail].filter((email): email is string => Boolean(email)).map((email) => email.toLowerCase())
      )
    );
    filteredGuests = filteredGuests.filter((guest) => {
      const email = guest.email?.trim().toLowerCase();
      const hasGiftCard = Boolean(email && emailSet.has(email));
      return definition.hasGiftCardPurchase ? hasGiftCard : !hasGiftCard;
    });
  }

  return filteredGuests;
}

async function buildCampaignPreview(actor: AuthUser, campaign: CampaignRow) {
  const segmentDefinition =
    campaign.segmentDefinition && typeof campaign.segmentDefinition === 'object' && !Array.isArray(campaign.segmentDefinition)
      ? (campaign.segmentDefinition as MarketingSegmentDefinition)
      : marketingSegmentDefinitionSchema.parse({});

  const guests = await loadGuestsForSegment(actor, segmentDefinition, campaign.venue);
  const skippedReasons: Record<string, number> = {};

  const rows = guests.map((guest) => {
    const outcome = recipientStatusForGuest(guest, campaign.channel);
    if (outcome.skipReason) {
      skippedReasons[outcome.skipReason] = (skippedReasons[outcome.skipReason] ?? 0) + 1;
    }
    return {
      guest: guestToPayload(guest),
      status: outcome.status,
      skipReason: outcome.skipReason,
      emailPreview: campaign.channel === 'EMAIL' ? renderMergeFields(campaign.subject ?? '', guest, campaign.venue ?? guest.venue ?? 'ALMA') : null
    };
  });

  return {
    guestCount: guests.length,
    includedCount: rows.filter((row) => row.status === 'PENDING').length,
    skippedCount: rows.filter((row) => row.status !== 'PENDING').length,
    skippedReasons,
    estimatedReachableEmailCount: rows.filter((row) => row.status === 'PENDING' && row.guest.email).length,
    guests: rows
  };
}

async function findScopedGuest(actor: AuthUser, guestId: string) {
  const guest = await prisma.reserveGuest.findFirst({
    where: {
      id: guestId,
      ...guestScope(actor)
    },
    include: guestInclude()
  });
  if (!guest) throw new HttpError(404, 'Guest not found');
  return guest;
}

export async function buildGuestTimeline(actor: AuthUser, guestId: string): Promise<GuestTimelinePayload> {
  const guest = await findScopedGuest(actor, guestId);
  const venue = actorVenueScope(actor, guest.venue, 'Marketing');
  const [reservations, campaignRecipients] = await Promise.all([
    prisma.reserveReservation.findMany({
      where: {
        guestId: guest.id,
        ...(venue ? { venue } : {})
      },
      select: {
        id: true,
        venue: true,
        startsAt: true,
        endsAt: true,
        covers: true,
        status: true,
        source: true,
        occasion: true,
        notes: true,
        specialRequests: true,
        createdAt: true,
        updatedAt: true,
        cancelledAt: true,
        completedAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 120
    }),
    prisma.marketingCampaignRecipient.findMany({
      where: {
        guestId: guest.id,
        campaign: {
          ...(venue ? { venue } : {})
        }
      },
      include: {
        campaign: {
          select: {
            id: true,
            venue: true,
            name: true,
            channel: true,
            status: true,
            subject: true,
            simulatedAt: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 80
    })
  ]);

  const campaignIds = Array.from(new Set(campaignRecipients.map((recipient) => recipient.campaignId)));
  const [contentPosts, giftCards] = await Promise.all([
    campaignIds.length
      ? prisma.marketingContentPost.findMany({
          where: {
            campaignId: { in: campaignIds },
            ...(venue ? { venue } : {})
          },
          select: {
            id: true,
            venue: true,
            title: true,
            status: true,
            scheduledAt: true,
            approvedAt: true,
            updatedAt: true,
            campaignId: true,
            targetChannels: true
          },
          orderBy: { updatedAt: 'desc' },
          take: 80
        })
      : Promise.resolve([]),
    guest.email
      ? prisma.giftCard.findMany({
          where: {
            OR: [
              { purchaserEmail: guest.email.toLowerCase() },
              { recipientEmail: guest.email.toLowerCase() }
            ]
          },
          select: {
            id: true,
            status: true,
            initialValueCents: true,
            balanceCents: true,
            amountPaidCents: true,
            purchaserEmail: true,
            recipientEmail: true,
            recipientName: true,
            createdAt: true,
            paidAt: true
          },
          orderBy: { createdAt: 'desc' },
          take: 40
        })
      : Promise.resolve([])
  ]);

  const timeline: GuestTimelinePayload['timeline'] = [];
  for (const reservation of reservations) {
    timeline.push({
      id: `reservation-created:${reservation.id}`,
      at: reservation.createdAt.toISOString(),
      type: 'RESERVATION_CREATED',
      title: 'Reservation created',
      description: `${reservation.covers} covers for ${reservation.startsAt.toISOString()}`,
      venue: reservation.venue,
      source: 'reserve',
      metadata: {
        reservationId: reservation.id,
        status: reservation.status,
        source: reservation.source,
        occasion: reservation.occasion,
        specialRequests: reservation.specialRequests
      }
    });
    timeline.push({
      id: `reservation-status:${reservation.id}:${reservation.status}`,
      at: (reservation.completedAt ?? reservation.cancelledAt ?? reservation.updatedAt).toISOString(),
      type: 'RESERVATION_STATUS',
      title: `Reservation ${reservation.status.replace(/_/g, ' ').toLowerCase()}`,
      description: `${reservation.covers} covers at ${reservation.startsAt.toISOString()}`,
      venue: reservation.venue,
      source: 'reserve',
      metadata: {
        reservationId: reservation.id,
        status: reservation.status,
        startsAt: reservation.startsAt.toISOString(),
        endsAt: reservation.endsAt.toISOString(),
        occasion: reservation.occasion,
        notes: reservation.notes
      }
    });
  }

  for (const assignment of guest.tagAssignments) {
    timeline.push({
      id: `tag:${assignment.id}`,
      at: assignment.assignedAt.toISOString(),
      type: 'TAG_ASSIGNED',
      title: `${assignment.tag.name} tag assigned`,
      description: `${assignment.source.toLowerCase()} tag on the guest profile.`,
      venue: assignment.tag.venue ?? guest.venue,
      source: 'marketing',
      metadata: {
        tagId: assignment.tagId,
        tagName: assignment.tag.name,
        tagType: assignment.tag.type,
        source: assignment.source,
        metadata: assignment.metadata
      }
    });
  }

  for (const recipient of campaignRecipients) {
    timeline.push({
      id: `campaign-recipient:${recipient.id}`,
      at: recipient.createdAt.toISOString(),
      type: 'CAMPAIGN_SIMULATED',
      title: `${recipient.campaign.name} campaign ${recipient.status.toLowerCase()}`,
      description: recipient.skipReason
        ? `Skipped from ${recipient.campaign.channel.toLowerCase()} simulation: ${recipient.skipReason}.`
        : `${recipient.campaign.channel.toLowerCase()} simulation only. No external send.`,
      venue: recipient.campaign.venue,
      source: 'marketing',
      metadata: {
        campaignId: recipient.campaignId,
        campaignName: recipient.campaign.name,
        channel: recipient.campaign.channel,
        status: recipient.status,
        skipReason: recipient.skipReason
      }
    });
  }

  for (const post of contentPosts) {
    const channels = jsonStringArray(post.targetChannels);
    timeline.push({
      id: `content:${post.id}`,
      at: (post.scheduledAt ?? post.approvedAt ?? post.updatedAt).toISOString(),
      type: 'CONTENT_TOUCHPOINT',
      title: `${post.title} content post`,
      description: `${post.status.toLowerCase().replace(/_/g, ' ')} social content linked to a campaign.`,
      venue: post.venue,
      source: 'content',
      metadata: {
        postId: post.id,
        campaignId: post.campaignId,
        status: post.status,
        scheduledAt: post.scheduledAt?.toISOString() ?? null,
        channels
      }
    });
  }

  for (const card of giftCards) {
    timeline.push({
      id: `gift-card:${card.id}`,
      at: (card.paidAt ?? card.createdAt).toISOString(),
      type: 'GIFT_CARD_ORDER',
      title: 'Gift card order matched by email',
      description: `${card.status.toLowerCase().replace(/_/g, ' ')} gift card for ${(card.initialValueCents / 100).toFixed(2)} AUD.`,
      venue: guest.venue,
      source: 'gift_cards',
      metadata: {
        giftCardId: card.id,
        status: card.status,
        initialValueCents: card.initialValueCents,
        balanceCents: card.balanceCents,
        amountPaidCents: card.amountPaidCents,
        matchedAs:
          card.purchaserEmail?.toLowerCase() === guest.email?.toLowerCase()
            ? 'purchaser'
            : card.recipientEmail?.toLowerCase() === guest.email?.toLowerCase()
              ? 'recipient'
              : 'unknown',
        recipientName: card.recipientName
      }
    });
  }

  if (guest.notes || guest.visitNotes || guest.dietaryNotes) {
    timeline.push({
      id: `internal-note:${guest.id}`,
      at: guest.updatedAt.toISOString(),
      type: 'INTERNAL_NOTE',
      title: 'Guest profile notes',
      description: 'Internal guest notes, preferences, or dietary details are recorded for manager review.',
      venue: guest.venue,
      source: 'staff',
      metadata: {
        notes: guest.notes,
        visitNotes: guest.visitNotes,
        dietaryNotes: guest.dietaryNotes
      }
    });
  }

  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return {
    guest: guestToPayload(guest),
    generatedAt: new Date().toISOString(),
    timeline: timeline.slice(0, 160)
  };
}

function validateContentAssetPayload(data: {
  assetType?: string;
  mimeType?: string;
  storageProvider?: string;
  publicUrl?: string | null;
  fileSizeBytes?: number;
}) {
  if (data.fileSizeBytes !== undefined && data.fileSizeBytes < 0) {
    throw new HttpError(400, 'Asset file size cannot be negative.');
  }
  if (data.storageProvider && data.storageProvider !== 'EXTERNAL_URL') {
    throw new HttpError(400, 'Direct content uploads are setup required. Register an external asset URL for now.');
  }
  if (data.storageProvider === 'EXTERNAL_URL' && !cleanText(data.publicUrl)) {
    throw new HttpError(400, 'External content assets require a public URL.');
  }
  if (data.assetType === 'IMAGE' && data.mimeType && !data.mimeType.toLowerCase().startsWith('image/')) {
    throw new HttpError(400, 'Image assets require an image MIME type.');
  }
  if (data.assetType === 'VIDEO' && data.mimeType && !data.mimeType.toLowerCase().startsWith('video/')) {
    throw new HttpError(400, 'Video assets require a video MIME type.');
  }
  if (data.assetType === 'DOCUMENT') {
    const mime = data.mimeType?.toLowerCase() ?? '';
    if (mime && !['application/pdf', 'text/plain'].includes(mime) && !mime.startsWith('application/')) {
      throw new HttpError(400, 'Document assets require a document MIME type.');
    }
  }
}

async function assertCampaignInContentScope(actor: AuthUser, campaignId: string | null | undefined, venue: string) {
  const cleaned = cleanText(campaignId);
  if (!cleaned) return null;
  const campaign = await prisma.marketingCampaign.findFirst({
    where: {
      id: cleaned,
      ...(isAdminActor(actor) ? {} : { venue: actor.venue }),
      OR: [{ venue }, { venue: null }]
    }
  });
  if (!campaign) throw new HttpError(404, 'Linked campaign not found in this venue scope.');
  return campaign.id;
}

async function findScopedContentAsset(actor: AuthUser, assetId: string) {
  const asset = await prisma.marketingContentAsset.findFirst({
    where: {
      id: assetId,
      ...(isAdminActor(actor) ? {} : { venue: actor.venue ?? '__none__' })
    }
  });
  if (!asset) throw new HttpError(404, 'Content asset not found');
  return asset;
}

async function findScopedContentPost(actor: AuthUser, postId: string) {
  const post = await prisma.marketingContentPost.findFirst({
    where: {
      id: postId,
      ...(isAdminActor(actor) ? {} : { venue: actor.venue ?? '__none__' })
    },
    include: contentPostWithRelationsArgs.include
  });
  if (!post) throw new HttpError(404, 'Content post not found');
  return post;
}

async function findScopedCampaign(actor: AuthUser, campaignId: string) {
  const campaign = await prisma.marketingCampaign.findFirst({
    where: {
      id: campaignId,
      ...(isAdminActor(actor) ? {} : { OR: [{ venue: actor.venue }, { venue: null }] })
    },
    include: campaignWithRecipientsArgs.include
  });
  if (!campaign) throw new HttpError(404, 'Campaign not found');
  return campaign;
}

async function findScopedSocialAccount(actor: AuthUser, accountId: string) {
  const account = await prisma.marketingSocialAccount.findFirst({
    where: {
      id: accountId,
      ...(isAdminActor(actor) ? {} : { venue: actor.venue ?? '__none__' })
    }
  });
  if (!account) throw new HttpError(404, 'Social account not found');
  return account;
}

function postHasAssetType(post: ContentPostRow, type: 'IMAGE' | 'VIDEO') {
  return post.assets.some((link) => link.asset.assetType === type && link.asset.status !== 'ARCHIVED');
}

function buildPlatformPreview(post: ContentPostRow, platform: SocialPlatform, accounts: SocialAccountRow[]) {
  const caption = post.caption.trim();
  const activeAssets = post.assets
    .filter((link) => link.asset.status !== 'ARCHIVED')
    .map((link) => link.asset)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const account = accounts.find((row) => row.platform === platform && row.venue === post.venue && row.status === 'CONNECTED');
  const liveReady = Boolean(account?.externalAccountId && account.tokenSecretRef);
  const mediaPreview = activeAssets.map((asset) => ({
    id: asset.id,
    type: asset.assetType,
    mimeType: asset.mimeType,
    publicUrl: asset.publicUrl,
    title: asset.title
  }));

  if (platform === 'INSTAGRAM' && !postHasAssetType(post, 'IMAGE') && !postHasAssetType(post, 'VIDEO')) {
    return {
      platform,
      status: 'MISSING_ASSET' as const,
      message: 'Instagram needs an image or video asset before simulation.',
      requestPreview: { platform, caption, media: mediaPreview, mode: 'simulation' }
    };
  }

  if (platform === 'TIKTOK' && !postHasAssetType(post, 'VIDEO')) {
    return {
      platform,
      status: 'UNSUPPORTED_MEDIA_TYPE' as const,
      message: 'TikTok publishing requires a video asset in this first version.',
      requestPreview: { platform, caption, media: mediaPreview, mode: 'simulation' }
    };
  }

  if (platform === 'FACEBOOK' && !caption && activeAssets.length === 0) {
    return {
      platform,
      status: 'MISSING_CAPTION' as const,
      message: 'Facebook needs a caption or an attached asset.',
      requestPreview: { platform, caption, media: mediaPreview, mode: 'simulation' }
    };
  }

  return {
    platform,
    status: 'READY_TO_SIMULATE' as const,
    message: liveReady
      ? 'Ready to simulate. Live publishing still requires enabling the social connector.'
      : 'Ready to simulate. Live publish is setup required until the account is connected with a secret reference.',
    requestPreview: {
      platform,
      venue: post.venue,
      title: post.title,
      caption,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      media: mediaPreview,
      livePublish: {
        ready: false,
        setupRequired: true,
        accountConfigured: Boolean(account),
        hasTokenSecretRef: Boolean(account?.tokenSecretRef)
      },
      mode: 'simulation'
    }
  };
}

async function buildContentPublishPreview(actor: AuthUser, postId: string) {
  const post = await findScopedContentPost(actor, postId);
  const targetChannels = jsonStringArray(post.targetChannels) as SocialPlatform[];
  const accounts = await prisma.marketingSocialAccount.findMany({
    where: { venue: post.venue, platform: { in: targetChannels } }
  });
  return {
    post: contentPostToPayload(post),
    previews: targetChannels.map((platform) => buildPlatformPreview(post, platform, accounts))
  };
}

export const marketingService = {
  async overview(actor: AuthUser, input: { venue?: string }) {
    const venue = actorVenueScope(actor, input.venue, 'Marketing');
    const guestWhere = guestScope(actor, venue);

    const [guests, tags, templates, campaigns, automations, recentReservations, totalGuests, optedInGuests] = await Promise.all([
      prisma.reserveGuest.findMany({
        where: guestWhere,
        include: guestInclude(),
        orderBy: [{ lastVisitAt: 'desc' }, { updatedAt: 'desc' }],
        take: 120
      }),
      prisma.guestTag.findMany({
        where: venue ? { OR: [{ venue }, { venue: null }] } : {},
        orderBy: [{ active: 'desc' }, { name: 'asc' }]
      }),
      prisma.marketingEmailTemplate.findMany({
        where: venue ? { OR: [{ venue }, { venue: null }] } : {},
        orderBy: [{ updatedAt: 'desc' }],
        take: 30
      }),
      prisma.marketingCampaign.findMany({
        where: venue ? { OR: [{ venue }, { venue: null }] } : {},
        include: {
          ...campaignWithRecipientsArgs.include,
          recipients: {
            ...campaignWithRecipientsArgs.include.recipients,
            take: 120
          }
        },
        orderBy: { updatedAt: 'desc' },
        take: 20
      }),
      prisma.marketingAutomation.findMany({
        where: venue ? { venue } : {},
        include: automationWithTemplateArgs.include,
        orderBy: { updatedAt: 'desc' },
        take: 20
      }),
      prisma.reserveReservation.findMany({
        where: {
          ...(venue ? { venue } : {}),
          startsAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        },
        include: { guest: { include: guestInclude() }, table: true, availabilityRule: true },
        orderBy: { startsAt: 'desc' },
        take: 15
      }),
      prisma.reserveGuest.count({ where: guestWhere }),
      prisma.reserveGuest.count({ where: { ...guestWhere, marketingOptIn: true, emailUnsubscribedAt: null } })
    ]);

    return {
      guests: guests.map(guestToPayload),
      tags: tags.map(tagToPayload),
      templates: templates.map(templateToPayload),
      campaigns: campaigns.map(campaignToPayload),
      automations: automations.map(automationToPayload),
      recentReservations: recentReservations.map((reservation) => ({
        id: reservation.id,
        venue: reservation.venue,
        serviceDate: reservation.serviceDate.toISOString(),
        servicePeriod: reservation.servicePeriod,
        startsAt: reservation.startsAt.toISOString(),
        endsAt: reservation.endsAt.toISOString(),
        covers: reservation.covers,
        status: reservation.status,
        source: reservation.source,
        tableId: reservation.tableId,
        guestId: reservation.guestId,
        availabilityRuleId: reservation.availabilityRuleId,
        guestName: reservation.guestName,
        guestEmail: reservation.guestEmail,
        guestPhone: reservation.guestPhone,
        occasion: reservation.occasion,
        notes: reservation.notes,
        specialRequests: reservation.specialRequests,
        internalNotes: reservation.internalNotes,
        marketingOptIn: reservation.marketingOptIn,
        createdById: reservation.createdById,
        cancelledAt: reservation.cancelledAt?.toISOString() ?? null,
        completedAt: reservation.completedAt?.toISOString() ?? null,
        createdAt: reservation.createdAt.toISOString(),
        updatedAt: reservation.updatedAt.toISOString(),
        guest: guestToPayload(reservation.guest),
        table: reservation.table
          ? {
              id: reservation.table.id,
              venue: reservation.table.venue,
              area: reservation.table.area,
              label: reservation.table.label,
              minCovers: reservation.table.minCovers,
              maxCovers: reservation.table.maxCovers,
              sortOrder: reservation.table.sortOrder,
              isActive: reservation.table.isActive,
              createdAt: reservation.table.createdAt.toISOString(),
              updatedAt: reservation.table.updatedAt.toISOString()
            }
          : null,
        availabilityRule: reservation.availabilityRule
          ? {
              id: reservation.availabilityRule.id,
              venue: reservation.availabilityRule.venue,
              name: reservation.availabilityRule.name,
              servicePeriod: reservation.availabilityRule.servicePeriod,
              active: reservation.availabilityRule.active,
              defaultDurationMinutes: reservation.availabilityRule.defaultDurationMinutes,
              minPartySize: reservation.availabilityRule.minPartySize,
              maxPartySize: reservation.availabilityRule.maxPartySize,
              daysOfWeek: reservation.availabilityRule.daysOfWeek,
              startTime: reservation.availabilityRule.startTime,
              endTime: reservation.availabilityRule.endTime,
              intervalMinutes: reservation.availabilityRule.intervalMinutes,
              capacity: reservation.availabilityRule.capacity,
              onlineEnabled: reservation.availabilityRule.onlineEnabled,
              googleReserveEnabled: reservation.availabilityRule.googleReserveEnabled,
              createdAt: reservation.availabilityRule.createdAt.toISOString(),
              updatedAt: reservation.availabilityRule.updatedAt.toISOString()
            }
          : null
      })),
      totals: {
        guests: totalGuests,
        optedInGuests,
        unsubscribedGuests: guests.filter((guest) => guest.emailUnsubscribedAt || guest.smsUnsubscribedAt).length,
        repeatVisitors: guests.filter((guest) => guest.totalVisits >= 2).length,
        bigSpenders: guests.filter((guest) => guest.totalSpendCents >= BIG_SPENDER_THRESHOLD_CENTS).length,
        lapsedGuests: guests.filter((guest) => guest.lastVisitAt && guest.lastVisitAt.getTime() < Date.now() - LAPSED_DAYS * 24 * 60 * 60 * 1000).length,
        recentCampaigns: campaigns.length,
        activeAutomations: automations.filter((automation) => automation.active).length
      }
    };
  },

  async listGuests(actor: AuthUser, input: { venue?: string; search?: string }) {
    const venue = actorVenueScope(actor, input.venue, 'Marketing');
    const search = cleanText(input.search);
    const guests = await prisma.reserveGuest.findMany({
      where: {
        ...guestScope(actor, venue),
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      include: guestInclude(),
      orderBy: [{ lastVisitAt: 'desc' }, { updatedAt: 'desc' }],
      take: 250
    });
    return guests.map(guestToPayload);
  },

  async getGuest(actor: AuthUser, guestId: string) {
    const guest = await findScopedGuest(actor, guestId);
    const venue = actorVenueScope(actor, guest.venue, 'Marketing');
    const reservations = await prisma.reserveReservation.findMany({
      where: {
        guestId: guest.id,
        ...(venue ? { venue } : {})
      },
      include: { guest: { include: guestInclude() }, table: true, availabilityRule: true },
      orderBy: { startsAt: 'desc' }
    });
    return {
      guest: guestToPayload(guest),
      reservations: reservations.map((reservation) => ({
        id: reservation.id,
        venue: reservation.venue,
        serviceDate: reservation.serviceDate.toISOString(),
        servicePeriod: reservation.servicePeriod,
        startsAt: reservation.startsAt.toISOString(),
        endsAt: reservation.endsAt.toISOString(),
        covers: reservation.covers,
        status: reservation.status,
        source: reservation.source,
        tableId: reservation.tableId,
        guestId: reservation.guestId,
        availabilityRuleId: reservation.availabilityRuleId,
        guestName: reservation.guestName,
        guestEmail: reservation.guestEmail,
        guestPhone: reservation.guestPhone,
        occasion: reservation.occasion,
        notes: reservation.notes,
        specialRequests: reservation.specialRequests,
        internalNotes: reservation.internalNotes,
        marketingOptIn: reservation.marketingOptIn,
        createdById: reservation.createdById,
        cancelledAt: reservation.cancelledAt?.toISOString() ?? null,
        completedAt: reservation.completedAt?.toISOString() ?? null,
        createdAt: reservation.createdAt.toISOString(),
        updatedAt: reservation.updatedAt.toISOString(),
        guest: guestToPayload(reservation.guest),
        table: reservation.table
          ? {
              id: reservation.table.id,
              venue: reservation.table.venue,
              area: reservation.table.area,
              label: reservation.table.label,
              minCovers: reservation.table.minCovers,
              maxCovers: reservation.table.maxCovers,
              sortOrder: reservation.table.sortOrder,
              isActive: reservation.table.isActive,
              createdAt: reservation.table.createdAt.toISOString(),
              updatedAt: reservation.table.updatedAt.toISOString()
            }
          : null,
        availabilityRule: reservation.availabilityRule
          ? {
              id: reservation.availabilityRule.id,
              venue: reservation.availabilityRule.venue,
              name: reservation.availabilityRule.name,
              servicePeriod: reservation.availabilityRule.servicePeriod,
              active: reservation.availabilityRule.active,
              defaultDurationMinutes: reservation.availabilityRule.defaultDurationMinutes,
              minPartySize: reservation.availabilityRule.minPartySize,
              maxPartySize: reservation.availabilityRule.maxPartySize,
              daysOfWeek: reservation.availabilityRule.daysOfWeek,
              startTime: reservation.availabilityRule.startTime,
              endTime: reservation.availabilityRule.endTime,
              intervalMinutes: reservation.availabilityRule.intervalMinutes,
              capacity: reservation.availabilityRule.capacity,
              onlineEnabled: reservation.availabilityRule.onlineEnabled,
              googleReserveEnabled: reservation.availabilityRule.googleReserveEnabled,
              createdAt: reservation.availabilityRule.createdAt.toISOString(),
              updatedAt: reservation.availabilityRule.updatedAt.toISOString()
            }
          : null
      }))
    };
  },

  async getGuestTimeline(actor: AuthUser, guestId: string) {
    return buildGuestTimeline(actor, guestId);
  },

  async listTags(actor: AuthUser, input: { venue?: string }) {
    const venue = actorVenueScope(actor, input.venue, 'Marketing');
    const tags = await prisma.guestTag.findMany({
      where: venue ? { OR: [{ venue }, { venue: null }] } : {},
      orderBy: [{ active: 'desc' }, { name: 'asc' }]
    });
    return tags.map(tagToPayload);
  },

  async createTag(actor: AuthUser, input: unknown) {
    const data = marketingTagInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue || actor.venue || null, 'Marketing');
    const slug = cleanText(data.slug) || tagSlugForVenue(data.name, venue);
    const tag = await prisma.guestTag.create({
      data: {
        venue,
        name: data.name.trim(),
        slug,
        description: cleanText(data.description),
        type: data.type,
        color: cleanText(data.color),
        ruleDefinition: (data.ruleDefinition ?? EMPTY_SEGMENT_DEFINITION) as Prisma.InputJsonValue,
        active: data.active
      }
    });
    return tagToPayload(tag);
  },

  async updateTag(actor: AuthUser, id: string, input: unknown) {
    const existing = await prisma.guestTag.findFirst({
      where: {
        id,
        ...(isAdminActor(actor) ? {} : { OR: [{ venue: actor.venue }, { venue: null }] })
      }
    });
    if (!existing) throw new HttpError(404, 'Tag not found');
    const data = marketingTagUpdateInputSchema.parse(input);
    const venue = data.venue !== undefined ? actorVenueScope(actor, data.venue, 'Marketing') : existing.venue;

    const tag = await prisma.guestTag.update({
      where: { id },
      data: {
        ...(data.venue !== undefined && { venue }),
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.slug !== undefined && { slug: cleanText(data.slug) || tagSlugForVenue(data.name ?? existing.name, venue) }),
        ...(data.description !== undefined && { description: cleanText(data.description) }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.color !== undefined && { color: cleanText(data.color) }),
        ...(data.ruleDefinition !== undefined && {
          ruleDefinition: (data.ruleDefinition ?? EMPTY_SEGMENT_DEFINITION) as Prisma.InputJsonValue
        }),
        ...(data.active !== undefined && { active: data.active })
      }
    });
    return tagToPayload(tag);
  },

  async assignGuestTag(actor: AuthUser, guestId: string, tagId: string) {
    const guest = await findScopedGuest(actor, guestId);
    const tag = await prisma.guestTag.findFirst({
      where: {
        id: tagId,
        ...(isAdminActor(actor) ? {} : { OR: [{ venue: actor.venue }, { venue: null }] })
      }
    });
    if (!tag) throw new HttpError(404, 'Tag not found');
    if (tag.venue && guest.venue && tag.venue !== guest.venue) {
      throw new HttpError(400, 'Tag venue does not match guest venue');
    }

    await prisma.$transaction(async (tx) => {
      await tx.guestTagAssignment.upsert({
        where: {
          guestId_tagId: { guestId: guest.id, tagId: tag.id }
        },
        create: {
          guestId: guest.id,
          tagId: tag.id,
          source: tag.type === 'AUTOMATIC' ? 'AUTOMATIC' : 'MANUAL',
          assignedByStaffId: actor.id
        },
        update: {
          source: tag.type === 'AUTOMATIC' ? 'AUTOMATIC' : 'MANUAL',
          assignedByStaffId: actor.id
        }
      });

      const assignments = await tx.guestTagAssignment.findMany({
        where: { guestId: guest.id },
        include: { tag: true }
      });

      await tx.reserveGuest.update({
        where: { id: guest.id },
        data: {
          tags: assignments.filter((assignment) => assignment.tag.active).map((assignment) => assignment.tag.name)
        }
      });
    });

    return this.getGuest(actor, guestId);
  },

  async removeGuestTag(actor: AuthUser, guestId: string, tagId: string) {
    const guest = await findScopedGuest(actor, guestId);
    const assignment = await prisma.guestTagAssignment.findFirst({
      where: { guestId, tagId },
      include: { tag: true }
    });
    if (!assignment) return this.getGuest(actor, guestId);
    if (assignment.source !== 'MANUAL' && assignment.tag.type !== 'MANUAL' && assignment.tag.type !== 'CUSTOM') {
      throw new HttpError(400, 'Automatic tags can only be removed by recalculation.');
    }

    await prisma.$transaction(async (tx) => {
      await tx.guestTagAssignment.delete({ where: { id: assignment.id } });
      const assignments = await tx.guestTagAssignment.findMany({
        where: { guestId: guest.id },
        include: { tag: true }
      });
      await tx.reserveGuest.update({
        where: { id: guest.id },
        data: {
          tags: assignments.filter((row) => row.tag.active).map((row) => row.tag.name)
        }
      });
    });
    return this.getGuest(actor, guestId);
  },

  async recalculateAutoTags(actor: AuthUser, input: { venue?: string; guestId?: string }) {
    if (input.guestId) {
      const guest = await findScopedGuest(actor, input.guestId);
      return recalculateAutoTagsForGuest(guest.id);
    }

    const venue = actorVenueScope(actor, input.venue || actor.venue || null, 'Marketing');
    if (!venue) throw new HttpError(400, 'Venue is required to recalculate auto-tags.');
    const guests = await prisma.reserveGuest.findMany({
      where: guestScope(actor, venue),
      select: { id: true }
    });
    return recalculateAutoTagsForGuests(guests.map((guest) => guest.id));
  },

  async previewSegment(actor: AuthUser, input: unknown) {
    const data = marketingSegmentPreviewInputSchema.parse(input);
    const guests = await loadGuestsForSegment(actor, data.segmentDefinition, data.venue || null);
    const skippedReasons: Record<string, number> = {};
    const rows = guests.map((guest) => {
      const outcome = recipientStatusForGuest(guest, data.channel);
      if (outcome.skipReason) skippedReasons[outcome.skipReason] = (skippedReasons[outcome.skipReason] ?? 0) + 1;
      return guestToPayload(guest);
    });

    return {
      guestCount: guests.length,
      includedCount: guests.filter((guest) => recipientStatusForGuest(guest, data.channel).status === 'PENDING').length,
      skippedCount: guests.filter((guest) => recipientStatusForGuest(guest, data.channel).status !== 'PENDING').length,
      skippedReasons,
      estimatedReachableEmailCount: guests.filter((guest) => recipientStatusForGuest(guest, 'EMAIL').status === 'PENDING').length,
      guests: rows
    };
  },

  async createSegment(actor: AuthUser, input: unknown) {
    const data = marketingSegmentInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue || actor.venue || null, 'Marketing');
    const segment = await prisma.marketingSegment.create({
      data: {
        name: data.name.trim(),
        description: cleanText(data.description),
        venue,
        rules: data.rules as Prisma.InputJsonValue,
        isActive: data.isActive
      }
    });
    return {
      id: segment.id,
      name: segment.name,
      description: segment.description,
      venue: segment.venue,
      rules:
        segment.rules && typeof segment.rules === 'object' && !Array.isArray(segment.rules)
          ? (segment.rules as MarketingSegmentDefinition)
          : {},
      isActive: segment.isActive,
      createdAt: segment.createdAt.toISOString(),
      updatedAt: segment.updatedAt.toISOString()
    };
  },

  async listTemplates(actor: AuthUser, input: { venue?: string }) {
    const venue = actorVenueScope(actor, input.venue, 'Marketing');
    const templates = await prisma.marketingEmailTemplate.findMany({
      where: venue ? { OR: [{ venue }, { venue: null }] } : {},
      orderBy: [{ updatedAt: 'desc' }]
    });
    return templates.map(templateToPayload);
  },

  async createTemplate(actor: AuthUser, input: unknown) {
    const data = marketingTemplateInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue || actor.venue || null, 'Marketing');
    const template = await prisma.marketingEmailTemplate.create({
      data: {
        venue,
        name: data.name.trim(),
        subject: data.subject.trim(),
        previewText: cleanText(data.previewText),
        htmlBody: data.htmlBody.trim(),
        textBody: cleanText(data.textBody),
        status: data.status,
        createdByStaffId: actor.id
      }
    });
    return templateToPayload(template);
  },

  async updateTemplate(actor: AuthUser, id: string, input: unknown) {
    const existing = await prisma.marketingEmailTemplate.findFirst({
      where: {
        id,
        ...(isAdminActor(actor) ? {} : { OR: [{ venue: actor.venue }, { venue: null }] })
      }
    });
    if (!existing) throw new HttpError(404, 'Template not found');
    const data = marketingTemplateUpdateInputSchema.parse(input);
    const venue = data.venue !== undefined ? actorVenueScope(actor, data.venue, 'Marketing') : existing.venue;

    const template = await prisma.marketingEmailTemplate.update({
      where: { id },
      data: {
        ...(data.venue !== undefined && { venue }),
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.subject !== undefined && { subject: data.subject.trim() }),
        ...(data.previewText !== undefined && { previewText: cleanText(data.previewText) }),
        ...(data.htmlBody !== undefined && { htmlBody: data.htmlBody.trim() }),
        ...(data.textBody !== undefined && { textBody: cleanText(data.textBody) }),
        ...(data.status !== undefined && { status: data.status })
      }
    });
    return templateToPayload(template);
  },

  async listCampaigns(actor: AuthUser, input: { venue?: string }) {
    const venue = actorVenueScope(actor, input.venue, 'Marketing');
    const campaigns = await prisma.marketingCampaign.findMany({
      where: venue ? { OR: [{ venue }, { venue: null }] } : {},
      include: {
        ...campaignWithRecipientsArgs.include,
        recipients: {
          ...campaignWithRecipientsArgs.include.recipients,
          take: 200
        }
      },
      orderBy: { updatedAt: 'desc' }
    });
    return campaigns.map(campaignToPayload);
  },

  async createCampaign(actor: AuthUser, input: unknown) {
    const data = marketingCampaignInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue, 'Marketing');
    if (!venue) throw new HttpError(400, 'Campaign venue is required');
    if (data.channel === 'EMAIL' && !cleanText(data.subject)) {
      throw new HttpError(400, 'Email campaigns require a subject.');
    }

    const campaign = await prisma.marketingCampaign.create({
      data: {
        venue,
        name: data.name.trim(),
        channel: data.channel,
        status: data.status,
        audienceName: cleanText(data.audienceName),
        subject: cleanText(data.subject),
        previewText: cleanText(data.previewText),
        body: data.body.trim(),
        textBody: cleanText(data.textBody),
        segmentDefinition: {
          ...data.segmentDefinition,
          guestIds: Array.from(new Set([...(data.segmentDefinition.guestIds ?? []), ...data.guestIds]))
        } as Prisma.InputJsonValue,
        scheduledFor: parseOptionalDate(data.scheduledFor || undefined),
        createdById: actor.id
      },
      include: campaignWithRecipientsArgs.include
    });
    return campaignToPayload(campaign);
  },

  async getCampaign(actor: AuthUser, id: string) {
    const campaign = await findScopedCampaign(actor, id);
    return campaignToPayload(campaign);
  },

  async createContentPostFromCampaign(actor: AuthUser, campaignId: string) {
    const campaign = await findScopedCampaign(actor, campaignId);
    if (!campaign.venue) throw new HttpError(400, 'Campaign must be venue-scoped before creating content.');
    actorVenueScope(actor, campaign.venue, 'Marketing Content');
    const text = stripHtml(campaign.body || campaign.previewText || campaign.name);
    const post = await prisma.marketingContentPost.create({
      data: {
        venue: campaign.venue,
        createdByStaffId: actor.id,
        title: truncate(campaign.name, 160),
        caption: truncate(text || campaign.subject || campaign.name, 2200),
        status: 'DRAFT',
        campaignId: campaign.id,
        targetChannels: ['FACEBOOK', 'INSTAGRAM'] as Prisma.InputJsonValue,
        contentPillar: campaign.name.toLowerCase().includes('gift') ? 'gift_cards' : 'bookings',
        approvalRequired: true
      },
      include: contentPostWithRelationsArgs.include
    });
    return {
      campaign: campaignToPayload(campaign),
      post: contentPostToPayload(post)
    };
  },

  async updateCampaign(actor: AuthUser, id: string, input: unknown) {
    const existing = await prisma.marketingCampaign.findFirst({
      where: {
        id,
        ...(isAdminActor(actor) ? {} : { OR: [{ venue: actor.venue }, { venue: null }] })
      }
    });
    if (!existing) throw new HttpError(404, 'Campaign not found');
    const data = marketingCampaignUpdateInputSchema.parse(input);
    const venue = data.venue !== undefined ? actorVenueScope(actor, data.venue, 'Marketing') : existing.venue;

    const campaign = await prisma.marketingCampaign.update({
      where: { id },
      data: {
        ...(data.venue !== undefined && { venue }),
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.channel !== undefined && { channel: data.channel }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.audienceName !== undefined && { audienceName: cleanText(data.audienceName) }),
        ...(data.subject !== undefined && { subject: cleanText(data.subject) }),
        ...(data.previewText !== undefined && { previewText: cleanText(data.previewText) }),
        ...(data.body !== undefined && { body: data.body.trim() }),
        ...(data.textBody !== undefined && { textBody: cleanText(data.textBody) }),
        ...(data.segmentDefinition !== undefined && {
          segmentDefinition: {
            ...data.segmentDefinition,
            guestIds: Array.from(new Set([...(data.segmentDefinition.guestIds ?? []), ...(data.guestIds ?? [])]))
          } as Prisma.InputJsonValue
        }),
        ...(data.scheduledFor !== undefined && { scheduledFor: parseOptionalDate(data.scheduledFor || undefined) })
      },
      include: campaignWithRecipientsArgs.include
    });
    return campaignToPayload(campaign);
  },

  async previewCampaignRecipients(actor: AuthUser, campaignId: string) {
    const campaign = await prisma.marketingCampaign.findFirst({
      where: {
        id: campaignId,
        ...(isAdminActor(actor) ? {} : { OR: [{ venue: actor.venue }, { venue: null }] })
      },
      include: campaignWithRecipientsArgs.include
    });
    if (!campaign) throw new HttpError(404, 'Campaign not found');
    return buildCampaignPreview(actor, campaign as CampaignRow);
  },

  async simulateCampaignSend(actor: AuthUser, campaignId: string) {
    const campaign = await prisma.marketingCampaign.findFirst({
      where: {
        id: campaignId,
        ...(isAdminActor(actor) ? {} : { OR: [{ venue: actor.venue }, { venue: null }] })
      },
      include: campaignWithRecipientsArgs.include
    });
    if (!campaign) throw new HttpError(404, 'Campaign not found');
    if (campaign.channel === 'EMAIL' && !campaign.subject) {
      throw new HttpError(400, 'Email campaigns require a subject before simulation.');
    }

    const preview = await buildCampaignPreview(actor, campaign as CampaignRow);
    const guestRows = await loadGuestsForSegment(
      actor,
      (campaign.segmentDefinition as MarketingSegmentDefinition) ?? marketingSegmentDefinitionSchema.parse({}),
      campaign.venue
    );

    await prisma.$transaction(async (tx) => {
      await tx.marketingCampaignRecipient.deleteMany({ where: { campaignId: campaign.id } });
      for (const guest of guestRows) {
        const contact = await ensureMarketingContact(tx, guest);
        const outcome = recipientStatusForGuest(guest, campaign.channel);
        await tx.marketingCampaignRecipient.create({
          data: {
            campaignId: campaign.id,
            contactId: contact.id,
            guestId: guest.id,
            email: campaign.channel === 'EMAIL' ? guest.email : guest.phone,
            status: outcome.status === 'PENDING' ? 'SIMULATED' : 'SKIPPED',
            skipReason: outcome.skipReason
          }
        });
      }
      await tx.marketingCampaign.update({
        where: { id: campaign.id },
        data: {
          simulatedAt: new Date(),
          status: campaign.status === 'DRAFT' ? 'READY' : campaign.status
        }
      });
    });

    return {
      ...preview,
      simulated: true,
      message: 'Campaign simulation completed. No external emails were sent.'
    };
  },

  async contentDashboard(actor: AuthUser, input: { venue?: string }) {
    const venue = actorVenueScope(actor, input.venue, 'Marketing Content');
    const where = venue ? { venue } : {};
    const [
      assets,
      imageCount,
      videoCount,
      drafts,
      scheduledPosts,
      needsReview,
      failedPosts,
      upcomingPosts,
      recentAssets,
      socialAccounts,
      setupRequiredAccounts
    ] = await Promise.all([
      prisma.marketingContentAsset.count({ where: { ...where, status: { not: 'ARCHIVED' } } }),
      prisma.marketingContentAsset.count({ where: { ...where, assetType: 'IMAGE', status: { not: 'ARCHIVED' } } }),
      prisma.marketingContentAsset.count({ where: { ...where, assetType: 'VIDEO', status: { not: 'ARCHIVED' } } }),
      prisma.marketingContentPost.count({ where: { ...where, status: { in: ['IDEA', 'DRAFT'] } } }),
      prisma.marketingContentPost.count({ where: { ...where, status: 'SCHEDULED' } }),
      prisma.marketingContentPost.count({ where: { ...where, status: 'NEEDS_REVIEW' } }),
      prisma.marketingContentPost.count({ where: { ...where, status: 'FAILED' } }),
      prisma.marketingContentPost.findMany({
        where: {
          ...where,
          status: { in: ['APPROVED', 'SCHEDULED', 'PUBLISHING'] },
          scheduledAt: { not: null }
        },
        include: contentPostWithRelationsArgs.include,
        orderBy: { scheduledAt: 'asc' },
        take: 12
      }),
      prisma.marketingContentAsset.findMany({
        where: { ...where, status: { not: 'ARCHIVED' } },
        orderBy: { updatedAt: 'desc' },
        take: 12
      }),
      prisma.marketingSocialAccount.findMany({
        where,
        orderBy: [{ platform: 'asc' }, { venue: 'asc' }]
      }),
      prisma.marketingSocialAccount.count({
        where: { ...where, status: { in: ['SETUP_REQUIRED', 'ERROR', 'EXPIRED'] } }
      })
    ]);

    return {
      totals: {
        assets,
        images: imageCount,
        videos: videoCount,
        drafts,
        scheduledPosts,
        needsReview,
        failedPosts,
        setupRequiredAccounts
      },
      upcomingPosts: upcomingPosts.map(contentPostToPayload),
      recentAssets: recentAssets.map(contentAssetToPayload),
      socialAccounts: socialAccounts.map(socialAccountToPayload)
    };
  },

  async contentUploadConfig() {
    return {
      mode: 'external_url',
      message: 'Direct file storage is setup required. Register image or video assets by public URL for this version.',
      acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'application/pdf'],
      maxFileSizeBytes: 250 * 1024 * 1024
    };
  },

  async contentHelpers() {
    return CONTENT_HELPERS;
  },

  async listContentAssets(actor: AuthUser, input: { venue?: string; search?: string; type?: string; status?: string }) {
    const venue = actorVenueScope(actor, input.venue, 'Marketing Content');
    const search = cleanText(input.search);
    const assetType = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(input.type ?? '') ? input.type : undefined;
    const status = ['DRAFT', 'READY', 'ARCHIVED'].includes(input.status ?? '') ? input.status : undefined;
    const assets = await prisma.marketingContentAsset.findMany({
      where: {
        ...(venue ? { venue } : {}),
        ...(assetType ? { assetType: assetType as 'IMAGE' | 'VIDEO' | 'DOCUMENT' } : {}),
        ...(status ? { status: status as 'DRAFT' | 'READY' | 'ARCHIVED' } : { status: { not: 'ARCHIVED' } }),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
                { fileName: { contains: search, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      orderBy: { updatedAt: 'desc' },
      take: 200
    });
    return assets.map(contentAssetToPayload);
  },

  async createContentAsset(actor: AuthUser, input: unknown) {
    const data = marketingContentAssetInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue, 'Marketing Content');
    if (!venue) throw new HttpError(400, 'Venue is required for content assets.');
    validateContentAssetPayload(data);
    const asset = await prisma.marketingContentAsset.create({
      data: {
        venue,
        uploadedByStaffId: actor.id,
        title: data.title.trim(),
        description: cleanText(data.description),
        assetType: data.assetType,
        mimeType: data.mimeType.trim(),
        fileName: data.fileName.trim(),
        fileSizeBytes: data.fileSizeBytes,
        storageProvider: data.storageProvider,
        storagePath: cleanText(data.storagePath),
        publicUrl: cleanText(data.publicUrl),
        thumbnailUrl: cleanText(data.thumbnailUrl),
        width: data.width ?? null,
        height: data.height ?? null,
        durationSeconds: data.durationSeconds ?? null,
        status: data.status,
        tags: data.tags as Prisma.InputJsonValue,
        source: data.source
      }
    });
    return contentAssetToPayload(asset);
  },

  async getContentAsset(actor: AuthUser, assetId: string) {
    return contentAssetToPayload(await findScopedContentAsset(actor, assetId));
  },

  async updateContentAsset(actor: AuthUser, assetId: string, input: unknown) {
    const existing = await findScopedContentAsset(actor, assetId);
    const data = marketingContentAssetUpdateInputSchema.parse(input);
    const venue = data.venue !== undefined ? actorVenueScope(actor, data.venue, 'Marketing Content') : existing.venue;
    if (!venue) throw new HttpError(400, 'Venue is required for content assets.');
    validateContentAssetPayload({ ...existing, ...data });
    const asset = await prisma.marketingContentAsset.update({
      where: { id: existing.id },
      data: {
        ...(data.venue !== undefined && { venue }),
        ...(data.title !== undefined && { title: data.title.trim() }),
        ...(data.description !== undefined && { description: cleanText(data.description) }),
        ...(data.assetType !== undefined && { assetType: data.assetType }),
        ...(data.mimeType !== undefined && { mimeType: data.mimeType.trim() }),
        ...(data.fileName !== undefined && { fileName: data.fileName.trim() }),
        ...(data.fileSizeBytes !== undefined && { fileSizeBytes: data.fileSizeBytes }),
        ...(data.storageProvider !== undefined && { storageProvider: data.storageProvider }),
        ...(data.storagePath !== undefined && { storagePath: cleanText(data.storagePath) }),
        ...(data.publicUrl !== undefined && { publicUrl: cleanText(data.publicUrl) }),
        ...(data.thumbnailUrl !== undefined && { thumbnailUrl: cleanText(data.thumbnailUrl) }),
        ...(data.width !== undefined && { width: data.width ?? null }),
        ...(data.height !== undefined && { height: data.height ?? null }),
        ...(data.durationSeconds !== undefined && { durationSeconds: data.durationSeconds ?? null }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.tags !== undefined && { tags: data.tags as Prisma.InputJsonValue }),
        ...(data.source !== undefined && { source: data.source })
      }
    });
    return contentAssetToPayload(asset);
  },

  async archiveContentAsset(actor: AuthUser, assetId: string) {
    const existing = await findScopedContentAsset(actor, assetId);
    const asset = await prisma.marketingContentAsset.update({
      where: { id: existing.id },
      data: { status: 'ARCHIVED' }
    });
    return contentAssetToPayload(asset);
  },

  async listContentPosts(actor: AuthUser, input: { venue?: string; status?: string }) {
    const venue = actorVenueScope(actor, input.venue, 'Marketing Content');
    const status = ['IDEA', 'DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED', 'ARCHIVED'].includes(input.status ?? '')
      ? input.status
      : undefined;
    const posts = await prisma.marketingContentPost.findMany({
      where: {
        ...(venue ? { venue } : {}),
        ...(status
          ? {
              status: status as
                | 'IDEA'
                | 'DRAFT'
                | 'NEEDS_REVIEW'
                | 'APPROVED'
                | 'SCHEDULED'
                | 'PUBLISHING'
                | 'PUBLISHED'
                | 'FAILED'
                | 'CANCELLED'
                | 'ARCHIVED'
            }
          : { status: { not: 'ARCHIVED' } })
      },
      include: contentPostWithRelationsArgs.include,
      orderBy: [{ scheduledAt: 'asc' }, { updatedAt: 'desc' }],
      take: 200
    });
    return posts.map(contentPostToPayload);
  },

  async createContentPost(actor: AuthUser, input: unknown) {
    const data = marketingContentPostInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue, 'Marketing Content');
    if (!venue) throw new HttpError(400, 'Venue is required for content posts.');
    const campaignId = await assertCampaignInContentScope(actor, data.campaignId, venue);
    const post = await prisma.marketingContentPost.create({
      data: {
        venue,
        createdByStaffId: actor.id,
        title: data.title.trim(),
        caption: data.caption.trim(),
        status: data.status,
        scheduledAt: parseOptionalDate(data.scheduledAt || undefined),
        campaignId,
        targetChannels: data.targetChannels as Prisma.InputJsonValue,
        contentPillar: cleanText(data.contentPillar),
        approvalRequired: data.approvalRequired
      },
      include: contentPostWithRelationsArgs.include
    });
    return contentPostToPayload(post);
  },

  async createContentPostFromHelper(actor: AuthUser, helperId: string, input: { venue?: string; scheduledAt?: string }) {
    const helper = CONTENT_HELPERS.find((entry) => entry.id === helperId);
    if (!helper) throw new HttpError(404, 'Content helper not found');
    const venue = actorVenueScope(actor, input.venue || actor.venue || null, 'Marketing Content');
    if (!venue) throw new HttpError(400, 'Venue is required for content helpers.');
    const post = await prisma.marketingContentPost.create({
      data: {
        venue,
        createdByStaffId: actor.id,
        title: helper.label,
        caption: helper.caption,
        status: 'DRAFT',
        scheduledAt: parseOptionalDate(input.scheduledAt),
        targetChannels: helper.targetChannels as Prisma.InputJsonValue,
        contentPillar: helper.contentPillar,
        approvalRequired: true
      },
      include: contentPostWithRelationsArgs.include
    });
    return {
      helper,
      post: contentPostToPayload(post)
    };
  },

  async getContentPost(actor: AuthUser, postId: string) {
    return contentPostToPayload(await findScopedContentPost(actor, postId));
  },

  async createCampaignFromContentPost(actor: AuthUser, postId: string) {
    const post = await findScopedContentPost(actor, postId);
    const campaign = await prisma.marketingCampaign.create({
      data: {
        venue: post.venue,
        name: truncate(post.title, 120),
        channel: 'EMAIL',
        status: 'DRAFT',
        audienceName: 'Guests from linked content',
        subject: truncate(post.title, 140),
        previewText: truncate(post.caption, 160),
        body: `<h1>${escapeHtml(post.title)}</h1><p>${escapeHtml(post.caption)}</p><p><a href="{{bookingLink}}">Book a table</a></p>`,
        textBody: `${post.caption}\n\nBook a table: {{bookingLink}}`,
        segmentDefinition: {
          ...EMPTY_SEGMENT_DEFINITION,
          venue: post.venue,
          marketingOptInOnly: true,
          emailOnly: true,
          includeUnsubscribed: false
        } as Prisma.InputJsonValue,
        createdById: actor.id
      },
      include: campaignWithRecipientsArgs.include
    });
    const linkedPost = await prisma.marketingContentPost.update({
      where: { id: post.id },
      data: { campaignId: campaign.id },
      include: contentPostWithRelationsArgs.include
    });
    return {
      campaign: campaignToPayload(campaign),
      post: contentPostToPayload(linkedPost)
    };
  },

  async updateContentPost(actor: AuthUser, postId: string, input: unknown) {
    const existing = await findScopedContentPost(actor, postId);
    const data = marketingContentPostUpdateInputSchema.parse(input);
    const venue = data.venue !== undefined ? actorVenueScope(actor, data.venue, 'Marketing Content') : existing.venue;
    if (!venue) throw new HttpError(400, 'Venue is required for content posts.');
    const campaignId = data.campaignId !== undefined ? await assertCampaignInContentScope(actor, data.campaignId, venue) : existing.campaignId;
    const post = await prisma.marketingContentPost.update({
      where: { id: existing.id },
      data: {
        ...(data.venue !== undefined && { venue }),
        ...(data.title !== undefined && { title: data.title.trim() }),
        ...(data.caption !== undefined && { caption: data.caption.trim() }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.scheduledAt !== undefined && { scheduledAt: parseOptionalDate(data.scheduledAt || undefined) }),
        ...(data.campaignId !== undefined && { campaignId }),
        ...(data.targetChannels !== undefined && { targetChannels: data.targetChannels as Prisma.InputJsonValue }),
        ...(data.contentPillar !== undefined && { contentPillar: cleanText(data.contentPillar) }),
        ...(data.approvalRequired !== undefined && { approvalRequired: data.approvalRequired })
      },
      include: contentPostWithRelationsArgs.include
    });
    return contentPostToPayload(post);
  },

  async attachContentAsset(actor: AuthUser, postId: string, input: unknown) {
    const post = await findScopedContentPost(actor, postId);
    const data = marketingContentPostAssetInputSchema.parse(input);
    const asset = await findScopedContentAsset(actor, data.assetId);
    if (asset.venue !== post.venue) throw new HttpError(400, 'Asset and post must belong to the same venue.');
    const link = await prisma.marketingContentPostAsset.upsert({
      where: { postId_assetId: { postId: post.id, assetId: asset.id } },
      create: { postId: post.id, assetId: asset.id, sortOrder: data.sortOrder },
      update: { sortOrder: data.sortOrder }
    });
    return { ...link, createdAt: link.createdAt.toISOString() };
  },

  async detachContentAsset(actor: AuthUser, postId: string, assetId: string) {
    const post = await findScopedContentPost(actor, postId);
    const link = await prisma.marketingContentPostAsset.findFirst({ where: { postId: post.id, assetId } });
    if (link) await prisma.marketingContentPostAsset.delete({ where: { id: link.id } });
    return { ok: true };
  },

  async submitContentPostForReview(actor: AuthUser, postId: string) {
    const post = await findScopedContentPost(actor, postId);
    const updated = await prisma.marketingContentPost.update({
      where: { id: post.id },
      data: { status: 'NEEDS_REVIEW' },
      include: contentPostWithRelationsArgs.include
    });
    return contentPostToPayload(updated);
  },

  async approveContentPost(actor: AuthUser, postId: string) {
    const post = await findScopedContentPost(actor, postId);
    const updated = await prisma.marketingContentPost.update({
      where: { id: post.id },
      data: {
        status: post.scheduledAt ? 'SCHEDULED' : 'APPROVED',
        approvedByStaffId: actor.id,
        approvedAt: new Date()
      },
      include: contentPostWithRelationsArgs.include
    });
    return contentPostToPayload(updated);
  },

  async scheduleContentPost(actor: AuthUser, postId: string, input: unknown) {
    const post = await findScopedContentPost(actor, postId);
    const data = marketingContentScheduleInputSchema.parse(input);
    const scheduledAt = parseRequiredDate(data.scheduledAt);
    const updated = await prisma.marketingContentPost.update({
      where: { id: post.id },
      data: {
        scheduledAt,
        status: post.approvedAt || !post.approvalRequired ? 'SCHEDULED' : 'NEEDS_REVIEW'
      },
      include: contentPostWithRelationsArgs.include
    });
    return contentPostToPayload(updated);
  },

  async cancelContentPost(actor: AuthUser, postId: string) {
    const post = await findScopedContentPost(actor, postId);
    const updated = await prisma.marketingContentPost.update({
      where: { id: post.id },
      data: { status: 'CANCELLED' },
      include: contentPostWithRelationsArgs.include
    });
    return contentPostToPayload(updated);
  },

  async contentCalendar(actor: AuthUser, input: { venue?: string; from?: string; to?: string }) {
    const venue = actorVenueScope(actor, input.venue, 'Marketing Content');
    const from = input.from ? parseRequiredDate(input.from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const to = input.to ? parseRequiredDate(input.to) : new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
    if (to < from) throw new HttpError(400, 'Calendar end date must be after the start date.');
    const posts = await prisma.marketingContentPost.findMany({
      where: {
        ...(venue ? { venue } : {}),
        scheduledAt: { gte: from, lte: to },
        status: { not: 'ARCHIVED' }
      },
      include: contentPostWithRelationsArgs.include,
      orderBy: { scheduledAt: 'asc' }
    });
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      posts: posts.map(contentPostToPayload)
    };
  },

  async previewContentPublish(actor: AuthUser, postId: string) {
    return buildContentPublishPreview(actor, postId);
  },

  async simulateContentPublish(actor: AuthUser, postId: string) {
    const preview = await buildContentPublishPreview(actor, postId);
    const attempts = await prisma.$transaction(
      preview.previews.map((row) =>
        prisma.marketingContentPublishAttempt.create({
          data: {
            postId,
            platform: row.platform,
            status: row.status === 'READY_TO_SIMULATE' ? 'SIMULATED' : 'SKIPPED',
            mode: 'SIMULATION',
            requestPreview: row.requestPreview as Prisma.InputJsonValue,
            responsePreview: {
              simulationOnly: true,
              message: row.status === 'READY_TO_SIMULATE' ? 'Simulated. No external platform call was made.' : row.message
            } as Prisma.InputJsonValue,
            errorMessage: row.status === 'READY_TO_SIMULATE' ? null : row.message,
            processedAt: new Date()
          }
        })
      )
    );
    return {
      ...preview,
      attempts: attempts.map(publishAttemptToPayload),
      message: 'Social publishing simulation completed. No Meta or TikTok API calls were made.'
    };
  },

  async publishContentPost(actor: AuthUser, postId: string) {
    await findScopedContentPost(actor, postId);
    throw new HttpError(409, 'Live social publishing is setup required. Use simulate publish until Meta and TikTok OAuth connectors are configured.');
  },

  async listSocialAccounts(actor: AuthUser, input: { venue?: string }) {
    const venue = actorVenueScope(actor, input.venue, 'Marketing Content');
    const accounts = await prisma.marketingSocialAccount.findMany({
      where: venue ? { venue } : {},
      orderBy: [{ venue: 'asc' }, { platform: 'asc' }]
    });
    return accounts.map(socialAccountToPayload);
  },

  async createSocialAccount(actor: AuthUser, input: unknown) {
    const data = marketingSocialAccountInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue, 'Marketing Content');
    if (!venue) throw new HttpError(400, 'Venue is required for social accounts.');
    const account = await prisma.marketingSocialAccount.create({
      data: {
        venue,
        platform: data.platform,
        displayName: data.displayName.trim(),
        handle: cleanText(data.handle),
        externalAccountId: cleanText(data.externalAccountId),
        status: data.status,
        scopes: data.scopes as Prisma.InputJsonValue,
        tokenSecretRef: cleanText(data.tokenSecretRef),
        lastError: cleanText(data.lastError)
      }
    });
    return socialAccountToPayload(account);
  },

  async updateSocialAccount(actor: AuthUser, accountId: string, input: unknown) {
    const existing = await findScopedSocialAccount(actor, accountId);
    const data = marketingSocialAccountUpdateInputSchema.parse(input);
    const venue = data.venue !== undefined ? actorVenueScope(actor, data.venue, 'Marketing Content') : existing.venue;
    if (!venue) throw new HttpError(400, 'Venue is required for social accounts.');
    const account = await prisma.marketingSocialAccount.update({
      where: { id: existing.id },
      data: {
        ...(data.venue !== undefined && { venue }),
        ...(data.platform !== undefined && { platform: data.platform }),
        ...(data.displayName !== undefined && { displayName: data.displayName.trim() }),
        ...(data.handle !== undefined && { handle: cleanText(data.handle) }),
        ...(data.externalAccountId !== undefined && { externalAccountId: cleanText(data.externalAccountId) }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.scopes !== undefined && { scopes: data.scopes as Prisma.InputJsonValue }),
        ...(data.tokenSecretRef !== undefined && { tokenSecretRef: cleanText(data.tokenSecretRef) }),
        ...(data.lastError !== undefined && { lastError: cleanText(data.lastError) })
      }
    });
    return socialAccountToPayload(account);
  },

  async validateSocialAccountReadiness(actor: AuthUser, accountId: string) {
    const account = await findScopedSocialAccount(actor, accountId);
    const checks = [
      {
        label: `${account.platform} account connected`,
        ok: account.status === 'CONNECTED',
        message: account.status === 'CONNECTED' ? 'Account marked connected.' : 'OAuth connection is setup required.'
      },
      {
        label: 'External account id',
        ok: Boolean(account.externalAccountId),
        message: account.externalAccountId ? 'External account id is configured.' : 'Add the page/account id after OAuth setup.'
      },
      {
        label: 'Token secret reference',
        ok: Boolean(account.tokenSecretRef),
        message: account.tokenSecretRef ? 'Secret reference is present.' : 'Store OAuth tokens in a secret manager, not in app responses.'
      },
      {
        label: 'Live connector enabled',
        ok: false,
        message: 'Live Meta/TikTok publishing is intentionally disabled in this pass.'
      }
    ];
    return {
      account: socialAccountToPayload(account),
      ready: false,
      integrationStatus: 'SETUP_REQUIRED',
      checks
    };
  },

  async listAutomations(actor: AuthUser, input: { venue?: string }) {
    const venue = actorVenueScope(actor, input.venue, 'Marketing');
    const automations = await prisma.marketingAutomation.findMany({
      where: venue ? { venue } : {},
      include: automationWithTemplateArgs.include,
      orderBy: { updatedAt: 'desc' }
    });
    return automations.map(automationToPayload);
  },

  async createAutomation(actor: AuthUser, input: unknown) {
    const data = marketingAutomationInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue, 'Marketing');
    if (!venue) throw new HttpError(400, 'Automation venue is required');
    const automation = await prisma.marketingAutomation.create({
      data: {
        venue,
        name: data.name.trim(),
        triggerType: data.triggerType,
        segmentDefinition: data.segmentDefinition as Prisma.InputJsonValue,
        emailTemplateId: cleanText(data.emailTemplateId),
        delayHours: data.delayHours,
        active: data.active
      },
      include: automationWithTemplateArgs.include
    });
    return automationToPayload(automation);
  },

  async updateAutomation(actor: AuthUser, id: string, input: unknown) {
    const automationWhere: Prisma.MarketingAutomationWhereInput = { id };
    if (!isAdminActor(actor)) {
      if (!actor.venue) throw new HttpError(403, 'Marketing is limited to your venue.');
      automationWhere.venue = actor.venue;
    }
    const existing = await prisma.marketingAutomation.findFirst({
      where: automationWhere
    });
    if (!existing) throw new HttpError(404, 'Automation not found');
    const data = marketingAutomationUpdateInputSchema.parse(input);
    const venue = data.venue !== undefined ? actorVenueScope(actor, data.venue, 'Marketing') : existing.venue;

    const patch: Prisma.MarketingAutomationUncheckedUpdateInput = {};
    if (data.venue !== undefined && venue) patch.venue = venue;
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.triggerType !== undefined) patch.triggerType = data.triggerType;
    if (data.segmentDefinition !== undefined) patch.segmentDefinition = data.segmentDefinition as Prisma.InputJsonValue;
    if (data.emailTemplateId !== undefined) patch.emailTemplateId = cleanText(data.emailTemplateId);
    if (data.delayHours !== undefined) patch.delayHours = data.delayHours;
    if (data.active !== undefined) patch.active = data.active;

    const automation = await prisma.marketingAutomation.update({
      where: { id },
      data: patch,
      include: automationWithTemplateArgs.include
    });
    return automationToPayload(automation);
  },

  async simulateAutomation(actor: AuthUser, automationId: string) {
    const automationWhere: Prisma.MarketingAutomationWhereInput = { id: automationId };
    if (!isAdminActor(actor)) {
      if (!actor.venue) throw new HttpError(403, 'Marketing is limited to your venue.');
      automationWhere.venue = actor.venue;
    }
    const automation = await prisma.marketingAutomation.findFirst({
      where: automationWhere,
      include: automationWithTemplateArgs.include
    });
    if (!automation) throw new HttpError(404, 'Automation not found');

    const guests = await loadGuestsForSegment(
      actor,
      (automation.segmentDefinition as MarketingSegmentDefinition) ?? marketingSegmentDefinitionSchema.parse({}),
      automation.venue
    );

    const preview = guests.slice(0, 25).map((guest) => ({
      guest: guestToPayload(guest),
      status: recipientStatusForGuest(guest, 'EMAIL').status
    }));

    await prisma.marketingAutomationRun.createMany({
      data: guests.slice(0, 100).map((guest) => ({
        automationId: automation.id,
        guestId: guest.id,
        status: 'SIMULATED',
        reason: 'Simulation only. No external send.'
      }))
    });

    return {
      automation: automationToPayload(automation),
      guestCount: guests.length,
      preview,
      message: 'Automation simulation completed. No external emails were sent.'
    };
  }
};
