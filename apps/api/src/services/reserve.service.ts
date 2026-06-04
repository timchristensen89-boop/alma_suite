import { prisma } from '@alma/db';
import { Prisma } from '@prisma/client';
import {
  marketingSegmentDefinitionSchema,
  reserveAvailabilityRuleInputSchema,
  reserveAvailabilityRuleUpdateInputSchema,
  reserveBlackoutInputSchema,
  reserveGuestInputSchema,
  reserveGuestUpdateInputSchema,
  reservePublicAvailabilityInputSchema,
  reservePublicBookingInputSchema,
  reservePublicSetupIntentInputSchema,
  reservePublicWaitlistInputSchema,
  reserveNoShowChargeInputSchema,
  reserveReservationInputSchema,
  reserveReservationUpdateInputSchema,
  reserveTableInputSchema,
  reserveTableUpdateInputSchema,
  reserveTableLayoutInputSchema,
  reserveManagerWaitlistInputSchema,
  reserveWaitlistUpdateInputSchema,
  reserveDrinkPackageInputSchema,
  reserveDrinkPackageUpdateInputSchema,
  reserveDrinksPaymentIntentInputSchema,
  googleReserveIntegrationSettingInputSchema,
  type AuthUser,
  type ReserveGuest,
  type ReserveDrinkPackage,
  type ReserveDrinksLineItem,
  type ReserveDrinksPaymentIntentResponse,
  type ReserveNoShowChargeResult,
  type ReservePublicBookingConfirmation,
  type ReservePublicManageView,
  type ReservePublicSetupIntentResponse,
  type ReservePublicWaitlistConfirmation,
  type ReserveReservation,
  type ReserveReservationStatus,
  type ReserveServicePeriod,
  type ReservePublicAvailabilitySlot,
  type ReserveWaitlistEntry,
  type MarketingSegmentDefinition
} from '@alma/shared';
import Stripe from 'stripe';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';
import { createReservationManageToken, reservationManageUrl, verifyReservationManageToken } from '../lib/reservation-manage-token.js';
import { mailService } from './mail.service.js';
import { buildGuestTimeline, recalculateAutoTagsForGuest } from './marketing.service.js';

const stripe = env.stripe.secretKey
  ? new Stripe(env.stripe.secretKey, {
      apiVersion: env.stripe.apiVersion,
      ...(env.stripe.context && { stripeContext: env.stripe.context })
    })
  : null;

// Default no-show fee per cover ($50). Manager call can override per
// reservation. Stripe currency stays AUD inherited from the platform.
const DEFAULT_NO_SHOW_FEE_PER_COVER_CENTS = 5000;

async function resolveCardOnFileFromSetupIntent(input: {
  setupIntentId: string | null;
  paymentMethodId: string | null;
  customerId: string | null;
}): Promise<{
  setupIntentId: string;
  paymentMethodId: string;
  customerId: string;
  brand: string | null;
  last4: string | null;
} | null> {
  if (!input.setupIntentId || !stripe) return null;
  try {
    const setupIntent = await stripe.setupIntents.retrieve(input.setupIntentId, {
      expand: ['payment_method']
    });
    if (setupIntent.status !== 'succeeded') return null;
    const customerId = typeof setupIntent.customer === 'string'
      ? setupIntent.customer
      : setupIntent.customer?.id ?? input.customerId ?? null;
    const paymentMethodId = typeof setupIntent.payment_method === 'string'
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id ?? input.paymentMethodId ?? null;
    if (!customerId || !paymentMethodId) return null;
    const card = typeof setupIntent.payment_method === 'object'
      ? setupIntent.payment_method?.card ?? null
      : null;
    return {
      setupIntentId: setupIntent.id,
      paymentMethodId,
      customerId,
      brand: card?.brand ?? null,
      last4: card?.last4 ?? null
    };
  } catch (error) {
    console.error('[reserve] resolveCardOnFileFromSetupIntent failed', {
      setupIntentId: input.setupIntentId,
      reason: error instanceof Error ? error.message : 'unknown'
    });
    return null;
  }
}

function toDrinkPackagePayload(row: {
  id: string;
  venue: string;
  name: string;
  description: string | null;
  priceCents: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ReserveDrinkPackage {
  return {
    id: row.id,
    venue: row.venue,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

// Verify a drinks PaymentIntent the guest already paid, and reconstruct the
// line-items snapshot from the packages (server is the source of truth for
// names + prices). Also surfaces the saved card so the same card covers
// no-show protection (the intent is created with setup_future_usage).
async function resolveDrinksFromPaymentIntent(paymentIntentId: string, venue: string) {
  if (!stripe) throw new HttpError(503, 'Payments are not configured.');
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['payment_method'] });
  if (intent.metadata?.source !== 'reserve-drinks') {
    throw new HttpError(400, 'That payment is not a drinks pre-payment.');
  }
  if (intent.metadata?.venue && intent.metadata.venue !== venue) {
    throw new HttpError(400, 'Drinks payment is for a different venue.');
  }
  if (intent.status !== 'succeeded') {
    throw new HttpError(409, 'Drinks payment has not completed.');
  }
  let compact: Array<{ p: string; q: number }> = [];
  try {
    const parsed = JSON.parse(intent.metadata?.drinksItems ?? '[]');
    if (Array.isArray(parsed)) compact = parsed;
  } catch {
    compact = [];
  }
  let lineItems: ReserveDrinksLineItem[] = [];
  if (compact.length) {
    const pkgs = await prisma.reserveDrinkPackage.findMany({ where: { id: { in: compact.map((c) => c.p) } } });
    const byId = new Map(pkgs.map((p) => [p.id, p]));
    lineItems = compact
      .map((c) => {
        const p = byId.get(c.p);
        return p ? { packageId: p.id, name: p.name, priceCents: p.priceCents, qty: c.q } : null;
      })
      .filter((x): x is ReserveDrinksLineItem => x !== null);
  }
  const pm = intent.payment_method && typeof intent.payment_method === 'object' ? intent.payment_method : null;
  const customerId = typeof intent.customer === 'string' ? intent.customer : (intent.customer?.id ?? null);
  return {
    drinksPaymentIntentId: intent.id,
    drinksTotalCents: intent.amount,
    drinksLineItems: lineItems,
    customerId,
    paymentMethodId: pm?.id ?? (typeof intent.payment_method === 'string' ? intent.payment_method : null),
    brand: pm?.card?.brand ?? null,
    last4: pm?.card?.last4 ?? null
  };
}

const ACTIVE_BOOKING_STATUSES = new Set<ReserveReservationStatus>(['PENDING', 'CONFIRMED', 'SEATED']);
const VISIT_STATUSES = new Set<ReserveReservationStatus>(['SEATED', 'COMPLETED']);
const SYSTEM_PUBLIC_LIMITATIONS = [
  'Online bookings use venue capacity rules, not full table-combination logic yet.',
  'Google Reserve is setup-only in this pass and is not submitting live availability feeds yet.'
];
const EMPTY_SEGMENT_DEFINITION = marketingSegmentDefinitionSchema.parse({});

const reserveGuestWithTagsArgs = Prisma.validator<Prisma.ReserveGuestDefaultArgs>()({
  include: {
    tagAssignments: {
      include: { tag: true },
      orderBy: { assignedAt: 'desc' }
    }
  }
});

const reserveReservationWithRelationsArgs = Prisma.validator<Prisma.ReserveReservationDefaultArgs>()({
  include: {
    guest: {
      include: reserveGuestWithTagsArgs.include
    },
    table: true,
    availabilityRule: true
  }
});

type ReserveGuestRow = Prisma.ReserveGuestGetPayload<typeof reserveGuestWithTagsArgs>;

type ReserveTableRow = Prisma.ReserveTableGetPayload<Record<string, never>>;
type ReserveAvailabilityRuleRow = Prisma.ReserveAvailabilityRuleGetPayload<Record<string, never>>;
type GoogleReserveIntegrationRow = Prisma.GoogleReserveIntegrationSettingGetPayload<Record<string, never>>;
type ReserveReservationRow = Prisma.ReserveReservationGetPayload<typeof reserveReservationWithRelationsArgs>;

function parseDate(value: string, label: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${label} is invalid`);
  return date;
}

function parseOptionalDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value: Date) {
  const date = startOfDay(value);
  date.setDate(date.getDate() + 1);
  return date;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60 * 1000);
}

function formatSlotLabel(value: Date) {
  return value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function cleanText(value?: string | null) {
  return value?.trim() || null;
}

function jsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseRuleTime(date: Date, time: string, label: string) {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new HttpError(400, `${label} is invalid`);
  const parsed = new Date(date);
  parsed.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return parsed;
}

function isAdminActor(actor?: AuthUser | null) {
  return Boolean(actor?.isAdmin || actor?.role === 'ADMIN');
}

function actorVenueScope(actor?: AuthUser | null, requestedVenue?: string | null, product = 'Reserve') {
  const venue = requestedVenue?.trim() || null;
  if (!actor || isAdminActor(actor)) return venue;
  if (!actor.venue) throw new HttpError(403, `${product} requires a venue-scoped manager profile.`);
  if (venue && venue !== actor.venue) {
    throw new HttpError(403, `${product} is limited to your venue.`);
  }
  return actor.venue;
}

function guestScope(actor?: AuthUser | null, requestedVenue?: string | null): Prisma.ReserveGuestWhereInput {
  const venue = actorVenueScope(actor, requestedVenue, 'Reserve');
  if (!venue) return {};
  return {
    OR: [{ venue }, { reservations: { some: { venue } } }]
  };
}

function reservationScope(actor?: AuthUser | null, requestedVenue?: string | null): Prisma.ReserveReservationWhereInput {
  const venue = actorVenueScope(actor, requestedVenue, 'Reserve');
  return venue ? { venue } : {};
}

function tableScope(actor?: AuthUser | null, requestedVenue?: string | null): Prisma.ReserveTableWhereInput {
  const venue = actorVenueScope(actor, requestedVenue, 'Reserve');
  return venue ? { venue } : {};
}

function ruleScope(actor?: AuthUser | null, requestedVenue?: string | null): Prisma.ReserveAvailabilityRuleWhereInput {
  const venue = actorVenueScope(actor, requestedVenue, 'Reserve');
  return venue ? { venue } : {};
}

function guestInclude() {
  return reserveGuestWithTagsArgs.include;
}

function toGuestPayload(guest: ReserveGuestRow): ReserveGuest {
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
        ruleDefinition:
          assignment.tag.ruleDefinition && typeof assignment.tag.ruleDefinition === 'object' && !Array.isArray(assignment.tag.ruleDefinition)
            ? ({ ...EMPTY_SEGMENT_DEFINITION, ...(assignment.tag.ruleDefinition as Record<string, unknown>) } as MarketingSegmentDefinition)
            : EMPTY_SEGMENT_DEFINITION,
        active: assignment.tag.active,
        createdAt: assignment.tag.createdAt.toISOString(),
        updatedAt: assignment.tag.updatedAt.toISOString()
      }
    }))
  };
}

function toTablePayload(table: ReserveTableRow) {
  return {
    id: table.id,
    venue: table.venue,
    area: table.area,
    label: table.label,
    minCovers: table.minCovers,
    maxCovers: table.maxCovers,
    sortOrder: table.sortOrder,
    isActive: table.isActive,
    posX: table.posX,
    posY: table.posY,
    width: table.width,
    height: table.height,
    rotation: table.rotation,
    shape: table.shape,
    seats: table.seats,
    createdAt: table.createdAt.toISOString(),
    updatedAt: table.updatedAt.toISOString()
  };
}

function toRulePayload(rule: ReserveAvailabilityRuleRow) {
  return {
    id: rule.id,
    venue: rule.venue,
    name: rule.name,
    servicePeriod: rule.servicePeriod,
    active: rule.active,
    defaultDurationMinutes: rule.defaultDurationMinutes,
    minPartySize: rule.minPartySize,
    maxPartySize: rule.maxPartySize,
    daysOfWeek: rule.daysOfWeek,
    startTime: rule.startTime,
    endTime: rule.endTime,
    intervalMinutes: rule.intervalMinutes,
    capacity: rule.capacity,
    onlineEnabled: rule.onlineEnabled,
    googleReserveEnabled: rule.googleReserveEnabled,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString()
  };
}

function toGoogleReservePayload(setting: GoogleReserveIntegrationRow) {
  return {
    id: setting.id,
    venue: setting.venue,
    enabled: setting.enabled,
    merchantId: setting.merchantId,
    integrationStatus: setting.integrationStatus,
    lastSyncAt: setting.lastSyncAt?.toISOString() ?? null,
    lastError: setting.lastError,
    createdAt: setting.createdAt.toISOString(),
    updatedAt: setting.updatedAt.toISOString()
  };
}

function toReservationPayload(reservation: ReserveReservationRow): ReserveReservation {
  return {
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
    drinksLineItems: (reservation.drinksLineItems as ReserveDrinksLineItem[] | null) ?? null,
    drinksTotalCents: reservation.drinksTotalCents ?? null,
    drinksPaidAt: reservation.drinksPaidAt?.toISOString() ?? null,
    drinksRedeemedAt: reservation.drinksRedeemedAt?.toISOString() ?? null,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
    guest: toGuestPayload(reservation.guest),
    table: reservation.table ? toTablePayload(reservation.table) : null,
    availabilityRule: reservation.availabilityRule ? toRulePayload(reservation.availabilityRule) : null
  };
}

async function findScopedGuestById(id: string, actor?: AuthUser | null) {
  const guest = await prisma.reserveGuest.findFirst({
    where: {
      id,
      ...guestScope(actor)
    },
    include: guestInclude()
  });
  if (!guest) throw new HttpError(404, 'Guest not found');
  return guest;
}

async function refreshGuestInsights(tx: Prisma.TransactionClient, guestId: string) {
  const [completedReservations, noShowCount] = await Promise.all([
    tx.reserveReservation.findMany({
      where: {
        guestId,
        status: { in: ['SEATED', 'COMPLETED'] }
      },
      orderBy: { startsAt: 'asc' },
      select: { startsAt: true }
    }),
    tx.reserveReservation.count({
      where: { guestId, status: 'NO_SHOW' }
    })
  ]);

  await tx.reserveGuest.update({
    where: { id: guestId },
    data: {
      totalVisits: completedReservations.length,
      firstVisitAt: completedReservations[0]?.startsAt ?? null,
      lastVisitAt: completedReservations.at(-1)?.startsAt ?? null,
      noShowCount
    }
  });
}

function guestWriteData(
  data: ReturnType<typeof reserveGuestInputSchema.parse>,
  venue: string
): Prisma.ReserveGuestUncheckedCreateInput {
  return {
    venue,
    firstName: data.firstName.trim(),
    lastName: data.lastName.trim(),
    email: data.email?.trim().toLowerCase() || null,
    phone: data.phone?.trim() || null,
    birthday: parseOptionalDate(data.birthday || undefined),
    tags: data.tags?.map((tag) => tag.trim()).filter(Boolean),
    allergyNotes: cleanText(data.allergyNotes),
    visitNotes: cleanText(data.visitNotes),
    notes: cleanText(data.notes),
    dietaryNotes: cleanText(data.dietaryNotes),
    preferences: (data.preferences ?? {}) as Prisma.InputJsonValue,
    marketingOptIn: data.marketingOptIn,
    source: cleanText(data.source) ?? 'staff_created'
  };
}

async function findOrCreateGuestForVenue(
  tx: Prisma.TransactionClient,
  venue: string,
  input: ReturnType<typeof reserveGuestInputSchema.parse>
): Promise<ReserveGuestRow> {
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;
  const existing = email || phone
    ? await tx.reserveGuest.findFirst({
        where: {
          AND: [
            {
              OR: [
                ...(email ? [{ email }] : []),
                ...(phone ? [{ phone }] : [])
              ]
            },
            {
              OR: [{ venue }, { reservations: { some: { venue } } }]
            }
          ]
        },
        include: guestInclude()
      })
    : null;

  if (existing) {
    const incoming = guestWriteData(input, existing.venue ?? venue);
    const incomingPreferences = jsonObject(input.preferences as Prisma.JsonValue | null | undefined);
    const existingPreferences = jsonObject(existing.preferences);
    return tx.reserveGuest.update({
      where: { id: existing.id },
      data: {
        venue: existing.venue ?? venue,
        firstName: input.firstName?.trim() || existing.firstName,
        lastName: input.lastName?.trim() || existing.lastName,
        email: incoming.email ?? existing.email,
        phone: incoming.phone ?? existing.phone,
        birthday: incoming.birthday ?? existing.birthday,
        tags: input.tags?.length ? incoming.tags : existing.tags,
        allergyNotes: incoming.allergyNotes ?? existing.allergyNotes,
        visitNotes: incoming.visitNotes ?? existing.visitNotes,
        notes: incoming.notes ?? existing.notes,
        dietaryNotes: incoming.dietaryNotes ?? existing.dietaryNotes,
        preferences: { ...existingPreferences, ...incomingPreferences } as Prisma.InputJsonValue,
        marketingOptIn: existing.marketingOptIn || input.marketingOptIn,
        source: existing.source || incoming.source
      },
      include: guestInclude()
    });
  }

  return tx.reserveGuest.create({
    data: guestWriteData(input, venue),
    include: guestInclude()
  });
}

async function ensureTableVenue(tableId: string | null | undefined, venue: string) {
  if (!tableId) return null;
  const table = await prisma.reserveTable.findUnique({ where: { id: tableId } });
  if (!table) throw new HttpError(404, 'Table not found');
  if (table.venue !== venue) throw new HttpError(400, 'Table does not belong to the selected venue');
  return table;
}

async function ensureRuleVenue(ruleId: string | null | undefined, venue: string) {
  if (!ruleId) return null;
  const rule = await prisma.reserveAvailabilityRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new HttpError(404, 'Availability rule not found');
  if (rule.venue !== venue) throw new HttpError(400, 'Availability rule does not belong to the selected venue');
  return rule;
}

async function listPublicSlots(input: ReturnType<typeof reservePublicAvailabilityInputSchema.parse>) {
  const serviceDate = startOfDay(parseDate(input.date, 'Service date'));
  const nextDay = endOfDay(serviceDate);
  const weekday = serviceDate.getDay();
  const ruleWhere: Prisma.ReserveAvailabilityRuleWhereInput = {
    venue: input.venue.trim(),
    active: true,
    onlineEnabled: true,
    minPartySize: { lte: input.partySize },
    maxPartySize: { gte: input.partySize }
  };

  const [rules, reservations, blackouts] = await Promise.all([
    prisma.reserveAvailabilityRule.findMany({
      where: ruleWhere,
      orderBy: [{ startTime: 'asc' }, { name: 'asc' }]
    }),
    prisma.reserveReservation.findMany({
      where: {
        venue: input.venue.trim(),
        startsAt: { gte: serviceDate, lt: nextDay },
        status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] }
      },
      select: {
        id: true,
        covers: true,
        startsAt: true,
        endsAt: true,
        availabilityRuleId: true,
        servicePeriod: true
      }
    }),
    prisma.reserveBlackout.findMany({
      where: {
        venue: input.venue.trim(),
        startAt: { lt: nextDay },
        endAt: { gt: serviceDate }
      }
    })
  ]);

  const slots: ReservePublicAvailabilitySlot[] = [];
  for (const rule of rules) {
    if (!rule.daysOfWeek.includes(weekday)) continue;
    if (input.servicePeriod && rule.servicePeriod && input.servicePeriod !== rule.servicePeriod) continue;

    const ruleStart = parseRuleTime(serviceDate, rule.startTime, 'Availability start time');
    const ruleEnd = parseRuleTime(serviceDate, rule.endTime, 'Availability end time');

    for (let cursor = new Date(ruleStart); cursor < ruleEnd; cursor = addMinutes(cursor, rule.intervalMinutes)) {
      const slotEnd = addMinutes(cursor, rule.defaultDurationMinutes);
      if (slotEnd > ruleEnd) break;

      const overlapsBlackout = blackouts.some(
        (blackout) => blackout.startAt < slotEnd && blackout.endAt > cursor
      );
      if (overlapsBlackout) continue;

      const reservedCovers = reservations.reduce((sum, reservation) => {
        const overlaps = reservation.startsAt < slotEnd && reservation.endsAt > cursor;
        if (!overlaps) return sum;
        if (reservation.availabilityRuleId && reservation.availabilityRuleId !== rule.id) return sum;
        if (!reservation.availabilityRuleId && rule.servicePeriod && reservation.servicePeriod !== rule.servicePeriod) return sum;
        return sum + reservation.covers;
      }, 0);

      const capacityRemaining = rule.capacity - reservedCovers;
      if (capacityRemaining < input.partySize) continue;

      slots.push({
        startsAt: cursor.toISOString(),
        endsAt: slotEnd.toISOString(),
        label: formatSlotLabel(cursor),
        capacityRemaining,
        availabilityRuleId: rule.id,
        servicePeriod: rule.servicePeriod
      });
    }
  }

  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export const reserveService = {
  async dashboard(actor: AuthUser, input: { date?: string; venue?: string }) {
    const venue = actorVenueScope(actor, input.venue, 'Reserve');
    const date = input.date ? startOfDay(parseDate(input.date, 'Dashboard date')) : startOfDay(new Date());
    const nextDay = endOfDay(date);
    const nextWeek = addDays(date, 7);

    const [todayReservations, upcomingReservations, recentGuests, recentNoShows, availabilityRules, integration] =
      await Promise.all([
        prisma.reserveReservation.findMany({
          where: {
            ...reservationScope(actor, venue),
            startsAt: { gte: date, lt: nextDay }
          },
          include: reserveReservationWithRelationsArgs.include,
          orderBy: { startsAt: 'asc' }
        }),
        prisma.reserveReservation.findMany({
          where: {
            ...reservationScope(actor, venue),
            startsAt: { gte: date, lt: nextWeek }
          },
          include: reserveReservationWithRelationsArgs.include,
          orderBy: { startsAt: 'asc' },
          take: 20
        }),
        prisma.reserveGuest.findMany({
          where: guestScope(actor, venue),
          include: guestInclude(),
          orderBy: { updatedAt: 'desc' },
          take: 8
        }),
        prisma.reserveReservation.findMany({
          where: {
            ...reservationScope(actor, venue),
            status: 'NO_SHOW'
          },
          include: reserveReservationWithRelationsArgs.include,
          orderBy: { updatedAt: 'desc' },
          take: 6
        }),
        prisma.reserveAvailabilityRule.findMany({
          where: { ...ruleScope(actor, venue), active: true },
          orderBy: [{ venue: 'asc' }, { startTime: 'asc' }]
        }),
        venue
          ? prisma.googleReserveIntegrationSetting.findUnique({ where: { venue } })
          : Promise.resolve(null)
      ]);

    const todayTotals = todayReservations.reduce(
      (summary, reservation) => {
        if (!['CANCELLED', 'NO_SHOW'].includes(reservation.status)) summary.coversToday += reservation.covers;
        if (reservation.status === 'CANCELLED') summary.cancellationsToday += 1;
        if (reservation.status === 'NO_SHOW') summary.noShowsToday += 1;
        return summary;
      },
      {
        coversToday: 0,
        cancellationsToday: 0,
        noShowsToday: 0
      }
    );

    return {
      date: date.toISOString(),
      venue,
      todayReservations: todayReservations.map(toReservationPayload),
      upcomingReservations: upcomingReservations.map(toReservationPayload),
      recentGuests: recentGuests.map(toGuestPayload),
      recentNoShows: recentNoShows.map(toReservationPayload),
      availabilityRules: availabilityRules.map(toRulePayload),
      integration: integration ? toGoogleReservePayload(integration) : null,
      totals: {
        coversToday: todayTotals.coversToday,
        todayBookings: todayReservations.length,
        cancellationsToday: todayTotals.cancellationsToday,
        noShowsToday: todayTotals.noShowsToday,
        newGuests30Days: recentGuests.filter((guest) => guest.totalVisits <= 1).length,
        repeatGuests30Days: recentGuests.filter((guest) => guest.totalVisits >= 2).length
      }
    };
  },

  async diary(actor: AuthUser, input: { start?: string; end?: string; venue?: string }) {
    const start = input.start ? parseDate(input.start, 'Diary start date') : startOfDay(new Date());
    const end = input.end ? parseDate(input.end, 'Diary end date') : addDays(start, 7);
    if (end <= start) throw new HttpError(400, 'Diary end date must be after start date');
    const venue = actorVenueScope(actor, input.venue, 'Reserve');

    const [reservations, tables] = await Promise.all([
      prisma.reserveReservation.findMany({
        where: {
          ...reservationScope(actor, venue),
          startsAt: { gte: start, lt: end }
        },
        orderBy: [{ startsAt: 'asc' }, { venue: 'asc' }],
        include: reserveReservationWithRelationsArgs.include
      }),
      prisma.reserveTable.findMany({
        where: {
          ...tableScope(actor, venue),
          isActive: true
        },
        orderBy: [{ venue: 'asc' }, { area: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }]
      })
    ]);

    return {
      start: start.toISOString(),
      end: end.toISOString(),
      venue: venue ?? 'All venues',
      reservations: reservations.map(toReservationPayload),
      tables: tables.map(toTablePayload),
      totals: {
        covers: reservations.filter((reservation) => !['CANCELLED', 'NO_SHOW'].includes(reservation.status)).reduce((sum, reservation) => sum + reservation.covers, 0),
        confirmed: reservations.filter((reservation) => reservation.status === 'CONFIRMED').length,
        seated: reservations.filter((reservation) => reservation.status === 'SEATED').length,
        completed: reservations.filter((reservation) => reservation.status === 'COMPLETED').length,
        cancelled: reservations.filter((reservation) => reservation.status === 'CANCELLED').length,
        noShow: reservations.filter((reservation) => reservation.status === 'NO_SHOW').length
      }
    };
  },

  async listGuests(actor: AuthUser, input: { venue?: string; search?: string; limit?: string }) {
    const venue = actorVenueScope(actor, input.venue, 'Reserve');
    const search = input.search?.trim();
    const limit = Math.min(Math.max(Number(input.limit ?? 100) || 100, 1), 250);

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
      take: limit
    });
    return guests.map(toGuestPayload);
  },

  async getGuest(actor: AuthUser, id: string) {
    return toGuestPayload(await findScopedGuestById(id, actor));
  },

  async guestTimeline(actor: AuthUser, id: string) {
    await findScopedGuestById(id, actor);
    return buildGuestTimeline(actor, id);
  },

  async createGuest(actor: AuthUser, input: unknown) {
    const data = reserveGuestInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue || actor.venue || null, 'Reserve');
    if (!venue) throw new HttpError(400, 'Guest venue is required');

    const guest = await prisma.$transaction((tx) => findOrCreateGuestForVenue(tx, venue, data));
    return toGuestPayload(guest);
  },

  async updateGuest(actor: AuthUser, id: string, input: unknown) {
    const existing = await findScopedGuestById(id, actor);
    const data = reserveGuestUpdateInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue || existing.venue || actor.venue || null, 'Reserve');
    if (!venue) throw new HttpError(400, 'Guest venue is required');

    const patch: Prisma.ReserveGuestUpdateInput = {};
    if (data.venue !== undefined) patch.venue = venue;
    if (data.firstName !== undefined) patch.firstName = data.firstName.trim();
    if (data.lastName !== undefined) patch.lastName = data.lastName.trim();
    if (data.email !== undefined) patch.email = data.email.trim().toLowerCase() || null;
    if (data.phone !== undefined) patch.phone = data.phone.trim() || null;
    if (data.birthday !== undefined) patch.birthday = parseOptionalDate(data.birthday || undefined);
    if (data.tags !== undefined) patch.tags = data.tags.map((tag) => tag.trim()).filter(Boolean);
    if (data.allergyNotes !== undefined) patch.allergyNotes = cleanText(data.allergyNotes);
    if (data.visitNotes !== undefined) patch.visitNotes = cleanText(data.visitNotes);
    if (data.notes !== undefined) patch.notes = cleanText(data.notes);
    if (data.dietaryNotes !== undefined) patch.dietaryNotes = cleanText(data.dietaryNotes);
    if (data.preferences !== undefined) patch.preferences = (data.preferences ?? {}) as Prisma.InputJsonValue;
    if (data.marketingOptIn !== undefined) patch.marketingOptIn = data.marketingOptIn;
    if (data.source !== undefined) patch.source = cleanText(data.source) ?? 'staff_created';

    const guest = await prisma.reserveGuest.update({
      where: { id: existing.id },
      data: patch,
      include: guestInclude()
    });
    return toGuestPayload(guest);
  },

  async guestReservations(actor: AuthUser, guestId: string) {
    await findScopedGuestById(guestId, actor);
    const venue = actorVenueScope(actor, undefined, 'Reserve');
    const reservations = await prisma.reserveReservation.findMany({
      where: {
        guestId,
        ...(venue ? { venue } : {})
      },
      include: reserveReservationWithRelationsArgs.include,
      orderBy: { startsAt: 'desc' }
    });
    return reservations.map(toReservationPayload);
  },

  async listReservations(actor: AuthUser, input: { venue?: string; date?: string; status?: string }) {
    const venue = actorVenueScope(actor, input.venue, 'Reserve');
    const date = input.date ? startOfDay(parseDate(input.date, 'Reservation date')) : null;
    const nextDay = date ? endOfDay(date) : null;
    const status = cleanText(input.status);

    const reservations = await prisma.reserveReservation.findMany({
      where: {
        ...reservationScope(actor, venue),
        ...(date && nextDay ? { startsAt: { gte: date, lt: nextDay } } : {}),
        ...(status ? { status: status as ReserveReservationStatus } : {})
      },
      include: reserveReservationWithRelationsArgs.include,
      orderBy: [{ startsAt: 'asc' }, { venue: 'asc' }]
    });

    return reservations.map(toReservationPayload);
  },

  async listTables(actor: AuthUser, venue?: string) {
    const scopedVenue = actorVenueScope(actor, venue, 'Reserve');
    const tables = await prisma.reserveTable.findMany({
      where: tableScope(actor, scopedVenue),
      orderBy: [{ venue: 'asc' }, { area: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }]
    });
    return tables.map(toTablePayload);
  },

  async createTable(actor: AuthUser, input: unknown) {
    const data = reserveTableInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue, 'Reserve');
    if (!venue) throw new HttpError(400, 'Table venue is required');

    const table = await prisma.reserveTable.upsert({
      where: {
        venue_label: { venue, label: data.label.trim() }
      },
      create: {
        venue,
        area: data.area.trim(),
        label: data.label.trim(),
        minCovers: data.minCovers,
        maxCovers: data.maxCovers,
        sortOrder: data.sortOrder,
        isActive: data.isActive,
        // Optional starting geometry for a table placed straight onto the plan.
        posX: data.posX ?? null,
        posY: data.posY ?? null,
        width: data.width ?? null,
        height: data.height ?? null,
        rotation: data.rotation ?? 0,
        shape: data.shape ?? 'rect',
        seats: data.seats ?? null
      },
      // On re-upsert of an existing label, preserve floor-plan geometry —
      // metadata edits shouldn't move the table. Geometry is owned by
      // updateTable / saveTableLayout.
      update: {
        area: data.area.trim(),
        minCovers: data.minCovers,
        maxCovers: data.maxCovers,
        sortOrder: data.sortOrder,
        isActive: data.isActive
      }
    });
    return toTablePayload(table);
  },

  // Single-table edit from the floor-plan editor: metadata and/or geometry.
  async updateTable(actor: AuthUser, id: string, input: unknown) {
    const data = reserveTableUpdateInputSchema.parse(input);
    const existing = await prisma.reserveTable.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Table not found.');
    const allowedVenue = actorVenueScope(actor, existing.venue, 'Reserve');
    if (allowedVenue && existing.venue !== allowedVenue) {
      throw new HttpError(403, 'Reserve is limited to your venue.');
    }
    const patch: Prisma.ReserveTableUpdateInput = {};
    if (data.area !== undefined) patch.area = data.area.trim();
    if (data.label !== undefined) patch.label = data.label.trim();
    if (data.minCovers !== undefined) patch.minCovers = data.minCovers;
    if (data.maxCovers !== undefined) patch.maxCovers = data.maxCovers;
    if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    if (data.posX !== undefined) patch.posX = data.posX;
    if (data.posY !== undefined) patch.posY = data.posY;
    if (data.width !== undefined) patch.width = data.width;
    if (data.height !== undefined) patch.height = data.height;
    if (data.rotation !== undefined) patch.rotation = data.rotation;
    if (data.shape !== undefined) patch.shape = data.shape;
    if (data.seats !== undefined) patch.seats = data.seats;
    const table = await prisma.reserveTable.update({ where: { id }, data: patch });
    return toTablePayload(table);
  },

  // Batch geometry save — the editor persists the whole arrangement at once
  // (on "Done arranging" / debounced drag). Only tables in the actor's venue
  // scope are written; the full venue table list is returned.
  async saveTableLayout(actor: AuthUser, input: unknown) {
    const data = reserveTableLayoutInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue ?? null, 'Reserve');
    const ids = data.tables.map((t) => t.id);
    const existing = await prisma.reserveTable.findMany({ where: { id: { in: ids } } });
    const byId = new Map(existing.map((row) => [row.id, row]));
    const updates = data.tables.filter((t) => {
      const row = byId.get(t.id);
      if (!row) return false;
      if (venue && row.venue !== venue) return false;
      return true;
    });
    if (updates.length) {
      await prisma.$transaction(
        updates.map((t) =>
          prisma.reserveTable.update({
            where: { id: t.id },
            data: {
              posX: t.posX ?? null,
              posY: t.posY ?? null,
              ...(t.width !== undefined ? { width: t.width } : {}),
              ...(t.height !== undefined ? { height: t.height } : {}),
              ...(t.rotation !== undefined ? { rotation: t.rotation } : {}),
              ...(t.shape !== undefined ? { shape: t.shape } : {}),
              ...(t.seats !== undefined ? { seats: t.seats } : {})
            }
          })
        )
      );
    }
    const scopedVenue = venue ?? existing[0]?.venue;
    const tables = await prisma.reserveTable.findMany({
      where: tableScope(actor, scopedVenue),
      orderBy: [{ venue: 'asc' }, { area: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }]
    });
    return tables.map(toTablePayload);
  },

  async createReservation(actor: AuthUser, input: unknown) {
    const data = reserveReservationInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue, 'Reserve');
    if (!venue) throw new HttpError(400, 'Reservation venue is required');
    const startsAt = parseDate(data.startsAt, 'Reservation start time');
    const endsAt = parseDate(data.endsAt, 'Reservation end time');
    if (endsAt <= startsAt) throw new HttpError(400, 'Reservation end time must be after start time');
    await Promise.all([ensureTableVenue(data.tableId || null, venue), ensureRuleVenue(data.availabilityRuleId || null, venue)]);

    const managerDrinksIntentId = cleanText(data.drinksPaymentIntentId);
    const drinks = managerDrinksIntentId ? await resolveDrinksFromPaymentIntent(managerDrinksIntentId, venue) : null;

    const reservation = await prisma.$transaction(async (tx) => {
      let guest: ReserveGuestRow | null = data.guestId
        ? await tx.reserveGuest.findFirst({
            where: {
              id: data.guestId,
              OR: [{ venue }, { reservations: { some: { venue } } }]
            },
            include: guestInclude()
          })
        : null;
      if (!guest && data.guest) {
        guest = await findOrCreateGuestForVenue(tx, venue, {
          ...data.guest,
          venue
        });
      }
      if (!guest) throw new HttpError(400, 'Reservation needs a guest');

      const reservationRow = await tx.reserveReservation.create({
        data: {
          venue,
          serviceDate: startOfDay(parseDate(data.serviceDate, 'Service date')),
          servicePeriod: data.servicePeriod,
          startsAt,
          endsAt,
          covers: data.covers,
          status: data.status,
          source: cleanText(data.source) ?? 'manager',
          tableId: cleanText(data.tableId) ?? null,
          availabilityRuleId: cleanText(data.availabilityRuleId) ?? null,
          guestId: guest.id,
          guestName: cleanText(data.guestName) ?? ((`${guest.firstName} ${guest.lastName}`.trim()) || null),
          guestEmail: cleanText(data.guestEmail) ?? guest.email,
          guestPhone: cleanText(data.guestPhone) ?? guest.phone,
          occasion: cleanText(data.occasion),
          notes: cleanText(data.notes),
          specialRequests: cleanText(data.specialRequests),
          internalNotes: cleanText(data.internalNotes),
          marketingOptIn: data.marketingOptIn,
          createdById: actor.id,
          cancelledAt: data.status === 'CANCELLED' ? new Date() : null,
          completedAt: VISIT_STATUSES.has(data.status) ? new Date() : null,
          ...(drinks
            ? {
                stripeCustomerId: drinks.customerId,
                stripePaymentMethodId: drinks.paymentMethodId,
                stripePaymentMethodBrand: drinks.brand,
                stripePaymentMethodLast4: drinks.last4,
                drinksLineItems: drinks.drinksLineItems as Prisma.InputJsonValue,
                drinksTotalCents: drinks.drinksTotalCents,
                drinksPaymentIntentId: drinks.drinksPaymentIntentId,
                drinksPaidAt: new Date()
              }
            : {})
        },
        include: reserveReservationWithRelationsArgs.include
      });

      await tx.reserveGuest.update({
        where: { id: guest.id },
        data: {
          venue: guest.venue ?? venue,
          marketingOptIn: guest.marketingOptIn || data.marketingOptIn,
          lastVisitAt:
            VISIT_STATUSES.has(data.status) && (!guest.lastVisitAt || guest.lastVisitAt < startsAt)
              ? startsAt
              : guest.lastVisitAt
        }
      });
      await refreshGuestInsights(tx, guest.id);
      return reservationRow;
    });

    await recalculateAutoTagsForGuest(reservation.guestId).catch(() => undefined);

    // Fire a booking confirmation email if we have an email address.
    // Skip when status is CANCELLED (no point confirming a cancellation).
    if (reservation.guestEmail && reservation.status !== 'CANCELLED' && mailService.isConfigured()) {
      try {
        const reserveUrl = (process.env.RESERVE_WEB_URL ?? 'https://alma-reserve.web.app').replace(/\/+$/, '');
        const when = new Date(reservation.startsAt).toLocaleString('en-AU', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        await mailService.sendAlert({
          to: reservation.guestEmail,
          subject: `Booking confirmed at ${reservation.venue} — ${when}`,
          title: `Your booking at ${reservation.venue} is confirmed`,
          body: [
            `Hi ${reservation.guestName?.split(' ')[0] ?? 'there'},`,
            '',
            `We've got you down for ${reservation.covers} guest${reservation.covers === 1 ? '' : 's'} on ${when}.`,
            reservation.occasion ? `Occasion: ${reservation.occasion}` : '',
            reservation.specialRequests ? `Special requests: ${reservation.specialRequests}` : '',
            '',
            `If anything changes, just reply to this email or give the venue a call.`
          ].filter(Boolean).join('\n'),
          venue: reservation.venue,
          severity: 'info',
          ctaUrl: reserveUrl,
          ctaLabel: 'Visit the restaurant'
        });
      } catch (err) {
        console.error('[reserve] Failed to send booking confirmation email', err);
      }
    }

    return toReservationPayload(reservation);
  },

  async updateReservation(actor: AuthUser, id: string, input: unknown) {
    const existing = await prisma.reserveReservation.findFirst({
      where: { id, ...reservationScope(actor) },
      include: reserveReservationWithRelationsArgs.include
    });
    if (!existing) throw new HttpError(404, 'Reservation not found');

    const data: Partial<ReturnType<typeof reserveReservationInputSchema.parse>> =
      reserveReservationUpdateInputSchema.parse(input);
    const nextVenue = actorVenueScope(actor, data.venue || existing.venue, 'Reserve');
    if (!nextVenue) throw new HttpError(400, 'Reservation venue is required');

    if (data.tableId !== undefined) await ensureTableVenue(cleanText(data.tableId), nextVenue);
    if (data.availabilityRuleId !== undefined) await ensureRuleVenue(cleanText(data.availabilityRuleId), nextVenue);

    const patch: Prisma.ReserveReservationUncheckedUpdateInput = {};
    if (data.venue !== undefined) patch.venue = nextVenue;
    if (data.serviceDate !== undefined) patch.serviceDate = startOfDay(parseDate(data.serviceDate, 'Service date'));
    if (data.servicePeriod !== undefined) patch.servicePeriod = data.servicePeriod;
    if (data.startsAt !== undefined) patch.startsAt = parseDate(data.startsAt, 'Reservation start time');
    if (data.endsAt !== undefined) patch.endsAt = parseDate(data.endsAt, 'Reservation end time');
    if (data.covers !== undefined) patch.covers = data.covers;
    if (data.status !== undefined) patch.status = data.status;
    if (data.source !== undefined) patch.source = cleanText(data.source) ?? 'manager';
    if (data.tableId !== undefined) patch.tableId = cleanText(data.tableId) ?? null;
    if (data.availabilityRuleId !== undefined) patch.availabilityRuleId = cleanText(data.availabilityRuleId) ?? null;
    if (data.guestName !== undefined) patch.guestName = cleanText(data.guestName);
    if (data.guestEmail !== undefined) patch.guestEmail = cleanText(data.guestEmail)?.toLowerCase() ?? null;
    if (data.guestPhone !== undefined) patch.guestPhone = cleanText(data.guestPhone);
    if (data.occasion !== undefined) patch.occasion = cleanText(data.occasion);
    if (data.notes !== undefined) patch.notes = cleanText(data.notes);
    if (data.specialRequests !== undefined) patch.specialRequests = cleanText(data.specialRequests);
    if (data.internalNotes !== undefined) patch.internalNotes = cleanText(data.internalNotes);
    if (data.marketingOptIn !== undefined) patch.marketingOptIn = data.marketingOptIn;
    if (data.status !== undefined) {
      patch.cancelledAt = data.status === 'CANCELLED' ? new Date() : null;
      patch.completedAt = VISIT_STATUSES.has(data.status) ? new Date() : null;
    }

    const reservation = await prisma.$transaction(async (tx) => {
      const updated = await tx.reserveReservation.update({
        where: { id: existing.id },
        data: patch,
        include: reserveReservationWithRelationsArgs.include
      });

      if (data.marketingOptIn) {
        await tx.reserveGuest.update({
          where: { id: updated.guestId },
          data: { marketingOptIn: true }
        });
      }
      await refreshGuestInsights(tx, updated.guestId);
      return updated;
    });

    if (data.status !== undefined) {
      await recalculateAutoTagsForGuest(reservation.guestId).catch(() => undefined);
    }

    return toReservationPayload(reservation);
  },

  async listAvailabilityRules(actor: AuthUser, venue?: string) {
    const scopedVenue = actorVenueScope(actor, venue, 'Reserve');
    const rules = await prisma.reserveAvailabilityRule.findMany({
      where: ruleScope(actor, scopedVenue),
      orderBy: [{ venue: 'asc' }, { startTime: 'asc' }, { name: 'asc' }]
    });
    return rules.map(toRulePayload);
  },

  async createAvailabilityRule(actor: AuthUser, input: unknown) {
    const data = reserveAvailabilityRuleInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue, 'Reserve');
    if (!venue) throw new HttpError(400, 'Availability venue is required');

    const rule = await prisma.reserveAvailabilityRule.create({
      data: {
        venue,
        name: data.name.trim(),
        servicePeriod: typeof data.servicePeriod === 'string' && data.servicePeriod ? data.servicePeriod : null,
        active: data.active,
        defaultDurationMinutes: data.defaultDurationMinutes,
        minPartySize: data.minPartySize,
        maxPartySize: data.maxPartySize,
        daysOfWeek: data.daysOfWeek,
        startTime: data.startTime,
        endTime: data.endTime,
        intervalMinutes: data.intervalMinutes,
        capacity: data.capacity,
        onlineEnabled: data.onlineEnabled,
        googleReserveEnabled: data.googleReserveEnabled
      }
    });
    return toRulePayload(rule);
  },

  async updateAvailabilityRule(actor: AuthUser, id: string, input: unknown) {
    const existing = await prisma.reserveAvailabilityRule.findFirst({
      where: { id, ...ruleScope(actor) }
    });
    if (!existing) throw new HttpError(404, 'Availability rule not found');
    const data = reserveAvailabilityRuleUpdateInputSchema.parse(input);

    const patch: Prisma.ReserveAvailabilityRuleUpdateInput = {};
    if (data.venue !== undefined) {
      const nextVenue = actorVenueScope(actor, data.venue, 'Reserve');
      if (nextVenue) patch.venue = nextVenue;
    }
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.servicePeriod !== undefined) patch.servicePeriod = typeof data.servicePeriod === 'string' && data.servicePeriod ? data.servicePeriod : null;
    if (data.active !== undefined) patch.active = data.active;
    if (data.defaultDurationMinutes !== undefined) patch.defaultDurationMinutes = data.defaultDurationMinutes;
    if (data.minPartySize !== undefined) patch.minPartySize = data.minPartySize;
    if (data.maxPartySize !== undefined) patch.maxPartySize = data.maxPartySize;
    if (data.daysOfWeek !== undefined) patch.daysOfWeek = data.daysOfWeek;
    if (data.startTime !== undefined) patch.startTime = data.startTime;
    if (data.endTime !== undefined) patch.endTime = data.endTime;
    if (data.intervalMinutes !== undefined) patch.intervalMinutes = data.intervalMinutes;
    if (data.capacity !== undefined) patch.capacity = data.capacity;
    if (data.onlineEnabled !== undefined) patch.onlineEnabled = data.onlineEnabled;
    if (data.googleReserveEnabled !== undefined) patch.googleReserveEnabled = data.googleReserveEnabled;

    const rule = await prisma.reserveAvailabilityRule.update({
      where: { id },
      data: patch
    });
    return toRulePayload(rule);
  },

  async listBlackouts(actor: AuthUser, venue?: string) {
    const scopedVenue = actorVenueScope(actor, venue, 'Reserve');
    const blackouts = await prisma.reserveBlackout.findMany({
      where: scopedVenue ? { venue: scopedVenue } : {},
      orderBy: [{ startAt: 'asc' }, { endAt: 'asc' }]
    });
    return blackouts.map((blackout) => ({
      id: blackout.id,
      venue: blackout.venue,
      name: blackout.name,
      reason: blackout.reason,
      startAt: blackout.startAt.toISOString(),
      endAt: blackout.endAt.toISOString(),
      createdAt: blackout.createdAt.toISOString(),
      updatedAt: blackout.updatedAt.toISOString()
    }));
  },

  async createBlackout(actor: AuthUser, input: unknown) {
    const data = reserveBlackoutInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue, 'Reserve');
    if (!venue) throw new HttpError(400, 'Blackout venue is required');
    const startAt = parseDate(data.startAt, 'Blackout start');
    const endAt = parseDate(data.endAt, 'Blackout end');
    if (endAt <= startAt) throw new HttpError(400, 'Blackout end must be after start');
    const blackout = await prisma.reserveBlackout.create({
      data: {
        venue,
        name: data.name.trim(),
        reason: cleanText(data.reason),
        startAt,
        endAt
      }
    });
    return {
      id: blackout.id,
      venue: blackout.venue,
      name: blackout.name,
      reason: blackout.reason,
      startAt: blackout.startAt.toISOString(),
      endAt: blackout.endAt.toISOString(),
      createdAt: blackout.createdAt.toISOString(),
      updatedAt: blackout.updatedAt.toISOString()
    };
  },

  async getGoogleReserveIntegration(actor: AuthUser, venue?: string) {
    const scopedVenue = actorVenueScope(actor, venue, 'Reserve');
    if (!scopedVenue) throw new HttpError(400, 'Venue is required');
    const row = await prisma.googleReserveIntegrationSetting.findUnique({ where: { venue: scopedVenue } });
    return row
      ? toGoogleReservePayload(row)
      : {
          id: `virtual:${scopedVenue}`,
          venue: scopedVenue,
          enabled: false,
          merchantId: null,
          integrationStatus: 'SETUP_REQUIRED' as const,
          lastSyncAt: null,
          lastError: null,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString()
        };
  },

  async updateGoogleReserveIntegration(actor: AuthUser, venue: string, input: unknown) {
    const scopedVenue = actorVenueScope(actor, venue, 'Reserve');
    if (!scopedVenue) throw new HttpError(400, 'Venue is required');
    const safeInput = input && typeof input === 'object' ? input : {};
    const data = googleReserveIntegrationSettingInputSchema.parse({ ...safeInput, venue: scopedVenue });

    const setting = await prisma.googleReserveIntegrationSetting.upsert({
      where: { venue: scopedVenue },
      create: {
        venue: scopedVenue,
        enabled: data.enabled,
        merchantId: cleanText(data.merchantId),
        integrationStatus: data.integrationStatus,
        lastError: cleanText(data.lastError)
      },
      update: {
        enabled: data.enabled,
        merchantId: cleanText(data.merchantId),
        integrationStatus: data.integrationStatus,
        lastError: cleanText(data.lastError)
      }
    });
    return toGoogleReservePayload(setting);
  },

  async publicWidgetConfig() {
    const [settings, rules, integrations, drinkPackages] = await Promise.all([
      prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { venues: true } }),
      prisma.reserveAvailabilityRule.findMany({
        where: { active: true, onlineEnabled: true },
        select: { venue: true, googleReserveEnabled: true }
      }),
      prisma.googleReserveIntegrationSetting.findMany({
        select: { venue: true, enabled: true, merchantId: true, integrationStatus: true }
      }),
      prisma.reserveDrinkPackage.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, venue: true, name: true, description: true, priceCents: true }
      })
    ]);

    const configuredVenues =
      Array.isArray(settings?.venues)
        ? settings.venues
            .filter((venue): venue is { name: string } => typeof venue === 'object' && venue !== null && typeof (venue as { name?: unknown }).name === 'string')
            .map((venue) => venue.name)
        : [];

    const venues = configuredVenues.map((venue) => {
      const activeRules = rules.filter((rule) => rule.venue === venue).length;
      const integration = integrations.find((row) => row.venue === venue);
      return {
        name: venue,
        onlineEnabled: activeRules > 0,
        activeRules,
        googleReserveReady: Boolean(
          integration?.enabled &&
            integration.merchantId &&
            integration.integrationStatus === 'ACTIVE' &&
            rules.some((rule) => rule.venue === venue && rule.googleReserveEnabled)
        ),
        drinkPackages: drinkPackages
          .filter((p) => p.venue === venue)
          .map((p) => ({ id: p.id, name: p.name, description: p.description, priceCents: p.priceCents }))
      };
    });

    return {
      venues,
      limitations: SYSTEM_PUBLIC_LIMITATIONS
    };
  },

  async publicAvailability(input: unknown) {
    const data = reservePublicAvailabilityInputSchema.parse(input);
    return {
      venue: data.venue.trim(),
      serviceDate: startOfDay(parseDate(data.date, 'Service date')).toISOString(),
      partySize: data.partySize,
      slots: await listPublicSlots(data)
    };
  },

  // Function / event enquiry — emails the venue team without creating a
  // reservation. No new DB table for v1; we just send the enquiry through.
  async recordFunctionEnquiry(input: unknown) {
    if (!input || typeof input !== 'object') {
      throw new HttpError(400, 'Function enquiry payload required');
    }
    const data = input as Record<string, unknown>;
    const venue = typeof data.venue === 'string' ? data.venue.trim() : '';
    const contactName = typeof data.contactName === 'string' ? data.contactName.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim() : '';
    const phone = typeof data.phone === 'string' ? data.phone.trim() : '';
    const eventType = typeof data.eventType === 'string' ? data.eventType.trim() : '';
    const eventDate = typeof data.eventDate === 'string' ? data.eventDate.trim() : '';
    const partySize = typeof data.partySize === 'string' ? Number(data.partySize) : Number(data.partySize ?? 0);
    const notes = typeof data.notes === 'string' ? data.notes.trim() : '';

    if (!venue || !contactName || !email) {
      throw new HttpError(400, 'Venue, contact name, and email are required');
    }

    if (mailService.isConfigured()) {
      try {
        const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
        const recipient = settings?.notifyEmail?.trim();
        if (recipient) {
          await mailService.sendAlert({
            to: recipient,
            subject: `[Function enquiry] ${venue} — ${eventType || 'enquiry'} for ${partySize || '?'} guests`,
            title: `New function enquiry: ${eventType || 'event'} at ${venue}`,
            body: [
              `${contactName} (${email}${phone ? ` · ${phone}` : ''}) is asking about a function at ${venue}.`,
              '',
              eventDate ? `Preferred date: ${new Date(eventDate).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}` : 'No date specified.',
              `Party size: ${partySize || 'not specified'}`,
              eventType ? `Event type: ${eventType}` : '',
              '',
              notes ? `Notes:\n${notes}` : 'No additional notes.'
            ].filter(Boolean).join('\n'),
            venue,
            severity: 'info',
            ctaUrl: email ? `mailto:${email}` : undefined,
            ctaLabel: 'Reply to enquiry'
          });
        }
      } catch (err) {
        console.error('[reserve] Failed to send function enquiry email', err);
      }
    }

    return { received: true, venue, contactName, partySize };
  },

  async publicBook(input: unknown) {
    const data = reservePublicBookingInputSchema.parse(input);
    const serviceDate = startOfDay(parseDate(data.serviceDate, 'Service date'));
    const startsAt = parseDate(data.startsAt, 'Reservation start time');
    const venue = data.venue.trim();
    const preferences = {
      ...(cleanText(data.anniversary) ? { anniversary: cleanText(data.anniversary) } : {}),
      ...(cleanText(data.seatingPreference) ? { seatingPreference: cleanText(data.seatingPreference) } : {}),
      highChair: data.highChair,
      accessibility: data.accessibility,
      outdoorSeating: data.outdoorSeating,
      barSeating: data.barSeating
    };
    const requestLines = [
      cleanText(data.specialRequests),
      cleanText(data.dietaryNotes) ? `Dietary: ${cleanText(data.dietaryNotes)}` : null,
      cleanText(data.seatingPreference) ? `Seating: ${cleanText(data.seatingPreference)}` : null,
      data.highChair ? 'High chair requested' : null,
      data.accessibility ? 'Accessibility support requested' : null,
      data.outdoorSeating ? 'Outdoor seating preferred' : null,
      data.barSeating ? 'Bar seating preferred' : null
    ].filter((entry): entry is string => Boolean(entry));

    const slots = await listPublicSlots({
      venue,
      date: serviceDate.toISOString(),
      partySize: data.partySize,
      servicePeriod: ''
    });
    const slot = slots.find((entry) => entry.startsAt === startsAt.toISOString());
    if (!slot) throw new HttpError(409, 'That booking slot is no longer available.');

    const guest = await prisma.$transaction((tx) =>
      findOrCreateGuestForVenue(tx, venue, {
        venue,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        birthday: data.birthday,
        tags: [],
        allergyNotes: '',
        visitNotes: '',
        notes: '',
        dietaryNotes: data.dietaryNotes,
        preferences,
        marketingOptIn: data.marketingOptIn,
        source: 'public_widget'
      })
    );

    // Resolve the card-on-file details from the SetupIntent (if the
    // client confirmed one). We fetch the SetupIntent rather than
    // trusting the client because the brand/last4 we store are shown
    // to the manager, and a forged client payload could mislead them.
    const cardOnFile = await resolveCardOnFileFromSetupIntent({
      setupIntentId: cleanText(data.stripeSetupIntentId),
      paymentMethodId: cleanText(data.stripePaymentMethodId),
      customerId: cleanText(data.stripeCustomerId)
    });

    const drinksIntentId = cleanText(data.drinksPaymentIntentId);
    const drinks = drinksIntentId ? await resolveDrinksFromPaymentIntent(drinksIntentId, venue) : null;

    const reservation = await prisma.$transaction(async (tx) => {
      const created = await tx.reserveReservation.create({
        data: {
          venue,
          serviceDate,
          servicePeriod: slot.servicePeriod ?? 'DINNER',
          startsAt,
          endsAt: parseDate(slot.endsAt, 'Reservation end time'),
          covers: data.partySize,
          status: 'CONFIRMED',
          source: 'public_widget',
          availabilityRuleId: cleanText(data.availabilityRuleId) ?? slot.availabilityRuleId,
          guestId: guest.id,
          guestName: `${guest.firstName} ${guest.lastName}`.trim(),
          guestEmail: guest.email,
          guestPhone: guest.phone,
          occasion: cleanText(data.occasion),
          specialRequests: requestLines.length ? requestLines.join('\n') : null,
          marketingOptIn: data.marketingOptIn,
          stripeCustomerId: drinks?.customerId ?? cardOnFile?.customerId ?? null,
          stripeSetupIntentId: cardOnFile?.setupIntentId ?? null,
          stripePaymentMethodId: drinks?.paymentMethodId ?? cardOnFile?.paymentMethodId ?? null,
          stripePaymentMethodBrand: drinks?.brand ?? cardOnFile?.brand ?? null,
          stripePaymentMethodLast4: drinks?.last4 ?? cardOnFile?.last4 ?? null,
          ...(drinks
            ? {
                drinksLineItems: drinks.drinksLineItems as Prisma.InputJsonValue,
                drinksTotalCents: drinks.drinksTotalCents,
                drinksPaymentIntentId: drinks.drinksPaymentIntentId,
                drinksPaidAt: new Date()
              }
            : {})
        },
        include: reserveReservationWithRelationsArgs.include
      });

      if (data.marketingOptIn) {
        await tx.reserveGuest.update({
          where: { id: guest.id },
          data: { marketingOptIn: true }
        });
      }
      await refreshGuestInsights(tx, guest.id);
      return created;
    });

    await recalculateAutoTagsForGuest(reservation.guestId).catch(() => undefined);

    const manageToken = createReservationManageToken(reservation.id);
    const manageUrl = reservationManageUrl(
      reservation.id,
      process.env.RESERVE_WEB_URL ?? 'https://alma-reserve.web.app'
    );

    const confirmation: ReservePublicBookingConfirmation = {
      id: reservation.id,
      venue: reservation.venue,
      serviceDate: reservation.serviceDate.toISOString(),
      startsAt: reservation.startsAt.toISOString(),
      endsAt: reservation.endsAt.toISOString(),
      covers: reservation.covers,
      guestName: reservation.guestName ?? `${reservation.guest.firstName} ${reservation.guest.lastName}`.trim(),
      status: reservation.status,
      source: reservation.source,
      marketingOptIn: reservation.marketingOptIn,
      occasion: reservation.occasion,
      specialRequests: reservation.specialRequests,
      createdAt: reservation.createdAt.toISOString(),
      manageUrl,
      manageToken
    };

    // Fire-and-forget confirmation email with the manage URL. Failures
    // are logged by mailService — we don't want a flaky SMTP/Resend
    // outage to roll back a successful Stripe-less booking.
    const guestEmail = reservation.guest.email?.trim();
    if (guestEmail) {
      void mailService.sendReservationConfirmation({
        to: guestEmail,
        guestFirstName: reservation.guest.firstName,
        venue: reservation.venue,
        startsAt: reservation.startsAt,
        covers: reservation.covers,
        manageUrl
      }).catch((error) => {
        console.error('[reserve] confirmation email failed', {
          reservationId: reservation.id,
          reason: error instanceof Error ? error.message : 'unknown'
        });
      });
    }

    return confirmation;
  },

  // Booking waitlist — captures the guest's name + phone when their
  // desired date is fully booked. The host follows up manually (SMS
  // notification is a future task; v1 is capture-only).
  async recordPublicWaitlist(input: unknown): Promise<ReservePublicWaitlistConfirmation> {
    const data = reservePublicWaitlistInputSchema.parse(input);
    const windowStartsAt = new Date(data.windowStartsAt);
    const windowEndsAt = new Date(data.windowEndsAt);
    if (Number.isNaN(windowStartsAt.getTime()) || Number.isNaN(windowEndsAt.getTime())) {
      throw new HttpError(400, 'Enter a valid waitlist window.');
    }
    if (windowEndsAt < windowStartsAt) {
      throw new HttpError(400, 'Waitlist window end must be after the start.');
    }
    const entry = await prisma.reserveWaitlistEntry.create({
      data: {
        venue: data.venue.trim(),
        guestName: data.guestName.trim(),
        guestPhone: data.guestPhone.trim(),
        guestEmail: data.guestEmail?.trim().toLowerCase() || null,
        partySize: data.partySize,
        windowStartsAt,
        windowEndsAt,
        notes: data.notes?.trim() || null,
        source: 'public-widget'
      }
    });
    return {
      id: entry.id,
      venue: entry.venue,
      guestName: entry.guestName,
      partySize: entry.partySize,
      windowStartsAt: entry.windowStartsAt.toISOString(),
      windowEndsAt: entry.windowEndsAt.toISOString(),
      status: entry.status,
      createdAt: entry.createdAt.toISOString()
    };
  },

  // Manager-side walk-in / phone waitlist add (source = 'manager').
  async createWaitlistEntry(actor: AuthUser, input: unknown): Promise<ReserveWaitlistEntry> {
    const data = reserveManagerWaitlistInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue, 'Reserve');
    if (!venue) throw new HttpError(400, 'Waitlist venue is required');
    const windowStartsAt = new Date(data.windowStartsAt);
    const windowEndsAt = new Date(data.windowEndsAt);
    if (Number.isNaN(windowStartsAt.getTime()) || Number.isNaN(windowEndsAt.getTime())) {
      throw new HttpError(400, 'Enter a valid waitlist window.');
    }
    if (windowEndsAt < windowStartsAt) {
      throw new HttpError(400, 'Waitlist window end must be after the start.');
    }
    const entry = await prisma.reserveWaitlistEntry.create({
      data: {
        venue,
        guestName: data.guestName.trim(),
        guestPhone: data.guestPhone?.trim() || '—',
        guestEmail: data.guestEmail?.trim().toLowerCase() || null,
        partySize: data.partySize,
        windowStartsAt,
        windowEndsAt,
        notes: data.notes?.trim() || null,
        source: 'manager'
      }
    });
    return {
      id: entry.id,
      venue: entry.venue,
      guestName: entry.guestName,
      guestPhone: entry.guestPhone,
      guestEmail: entry.guestEmail,
      partySize: entry.partySize,
      windowStartsAt: entry.windowStartsAt.toISOString(),
      windowEndsAt: entry.windowEndsAt.toISOString(),
      notes: entry.notes,
      status: entry.status,
      source: entry.source,
      notifiedAt: entry.notifiedAt?.toISOString() ?? null,
      notifiedByName: entry.notifiedByName,
      matchedReservationId: entry.matchedReservationId,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString()
    };
  },

  async listWaitlist(actor: AuthUser, query: { venue?: string; status?: string }): Promise<ReserveWaitlistEntry[]> {
    // Venue-scoped managers must only see their venue's entries —
    // these rows include guest name, phone and email. Admins see all
    // venues when no `?venue=` filter is supplied.
    const scopedVenue = actorVenueScope(actor, query.venue ?? null, 'Reserve');
    const where: Prisma.ReserveWaitlistEntryWhereInput = {};
    if (scopedVenue) where.venue = scopedVenue;
    if (query.status) where.status = query.status as Prisma.EnumReserveWaitlistStatusFilter;
    const entries = await prisma.reserveWaitlistEntry.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200
    });
    return entries.map((entry) => ({
      id: entry.id,
      venue: entry.venue,
      guestName: entry.guestName,
      guestPhone: entry.guestPhone,
      guestEmail: entry.guestEmail,
      partySize: entry.partySize,
      windowStartsAt: entry.windowStartsAt.toISOString(),
      windowEndsAt: entry.windowEndsAt.toISOString(),
      notes: entry.notes,
      status: entry.status,
      source: entry.source,
      notifiedAt: entry.notifiedAt?.toISOString() ?? null,
      notifiedByName: entry.notifiedByName,
      matchedReservationId: entry.matchedReservationId,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString()
    }));
  },

  async updateWaitlistEntry(actor: AuthUser, id: string, input: unknown): Promise<ReserveWaitlistEntry> {
    const data = reserveWaitlistUpdateInputSchema.parse(input);
    // Confirm the entry is in the actor's venue scope before mutating.
    // Admins skip the check (actorVenueScope returns null).
    const existing = await prisma.reserveWaitlistEntry.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Waitlist entry not found.');
    const allowedVenue = actorVenueScope(actor, existing.venue, 'Reserve');
    if (allowedVenue && existing.venue !== allowedVenue) {
      throw new HttpError(403, 'Reserve is limited to your venue.');
    }
    const patch: Prisma.ReserveWaitlistEntryUpdateInput = {};
    if (data.status) {
      patch.status = data.status;
      if (data.status === 'NOTIFIED') {
        patch.notifiedAt = new Date();
        patch.notifiedById = actor.id;
        patch.notifiedByName = `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || actor.email;
      }
    }
    if (data.notes !== undefined) patch.notes = data.notes?.trim() || null;
    if (data.matchedReservationId !== undefined) patch.matchedReservationId = data.matchedReservationId || null;
    const entry = await prisma.reserveWaitlistEntry.update({ where: { id }, data: patch });
    return {
      id: entry.id,
      venue: entry.venue,
      guestName: entry.guestName,
      guestPhone: entry.guestPhone,
      guestEmail: entry.guestEmail,
      partySize: entry.partySize,
      windowStartsAt: entry.windowStartsAt.toISOString(),
      windowEndsAt: entry.windowEndsAt.toISOString(),
      notes: entry.notes,
      status: entry.status,
      source: entry.source,
      notifiedAt: entry.notifiedAt?.toISOString() ?? null,
      notifiedByName: entry.notifiedByName,
      matchedReservationId: entry.matchedReservationId,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString()
    };
  },

  async getPublicManageView(token: string): Promise<ReservePublicManageView> {
    const verified = verifyReservationManageToken(token);
    if (!verified) throw new HttpError(401, 'This management link has expired or is invalid.');
    const reservation = await prisma.reserveReservation.findUnique({
      where: { id: verified.reservationId },
      include: { guest: true }
    });
    if (!reservation) throw new HttpError(404, 'Reservation not found.');
    const now = Date.now();
    const startMs = reservation.startsAt.getTime();
    const hoursAway = (startMs - now) / (1000 * 60 * 60);
    // Match the policy text shown on the booking widget hero: 24-hour
    // cancellation window. Bookings inside 24h need to call the venue.
    const cancellable = ACTIVE_BOOKING_STATUSES.has(reservation.status) && hoursAway >= 24;
    const deadline = new Date(startMs - 24 * 60 * 60 * 1000);
    return {
      id: reservation.id,
      venue: reservation.venue,
      serviceDate: reservation.serviceDate.toISOString(),
      startsAt: reservation.startsAt.toISOString(),
      endsAt: reservation.endsAt.toISOString(),
      covers: reservation.covers,
      guestName: reservation.guestName ?? `${reservation.guest.firstName} ${reservation.guest.lastName}`.trim(),
      status: reservation.status,
      occasion: reservation.occasion,
      specialRequests: reservation.specialRequests,
      cancellable,
      cancellationDeadline: hoursAway >= 24 ? deadline.toISOString() : null,
      cancellationNotice: cancellable
        ? null
        : reservation.status !== 'PENDING' && reservation.status !== 'CONFIRMED'
          ? `This booking is already ${reservation.status.toLowerCase()}.`
          : 'Inside 24 hours of service — please call the venue to cancel.'
    };
  },

  async cancelPublicReservation(token: string): Promise<ReservePublicManageView> {
    const view = await this.getPublicManageView(token);
    if (!view.cancellable) {
      throw new HttpError(409, view.cancellationNotice ?? 'This booking cannot be cancelled online.');
    }
    await prisma.reserveReservation.update({
      where: { id: view.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() }
    });
    return this.getPublicManageView(token);
  },

  // Public — issue a SetupIntent that the Stripe Elements client
  // confirms with the guest's card. Used by the booking widget to
  // capture a card-on-file for no-show protection without charging.
  // ── Drinks packages (admin) ───────────────────────────────────────
  async listDrinkPackages(actor: AuthUser, venue?: string): Promise<ReserveDrinkPackage[]> {
    const scopedVenue = actorVenueScope(actor, venue ?? null, 'Reserve');
    const where: Prisma.ReserveDrinkPackageWhereInput = {};
    if (scopedVenue) where.venue = scopedVenue;
    const rows = await prisma.reserveDrinkPackage.findMany({
      where,
      orderBy: [{ venue: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }]
    });
    return rows.map(toDrinkPackagePayload);
  },

  async createDrinkPackage(actor: AuthUser, input: unknown): Promise<ReserveDrinkPackage> {
    const data = reserveDrinkPackageInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue, 'Reserve');
    if (!venue) throw new HttpError(400, 'Drink package venue is required');
    const row = await prisma.reserveDrinkPackage.upsert({
      where: { venue_name: { venue, name: data.name.trim() } },
      create: {
        venue,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        priceCents: data.priceCents,
        sortOrder: data.sortOrder,
        isActive: data.isActive
      },
      update: {
        description: data.description?.trim() || null,
        priceCents: data.priceCents,
        sortOrder: data.sortOrder,
        isActive: data.isActive
      }
    });
    return toDrinkPackagePayload(row);
  },

  async updateDrinkPackage(actor: AuthUser, id: string, input: unknown): Promise<ReserveDrinkPackage> {
    const data = reserveDrinkPackageUpdateInputSchema.parse(input);
    const existing = await prisma.reserveDrinkPackage.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Drink package not found.');
    const allowedVenue = actorVenueScope(actor, existing.venue, 'Reserve');
    if (allowedVenue && existing.venue !== allowedVenue) {
      throw new HttpError(403, 'Reserve is limited to your venue.');
    }
    const patch: Prisma.ReserveDrinkPackageUpdateInput = {};
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.description !== undefined) patch.description = data.description?.trim() || null;
    if (data.priceCents !== undefined) patch.priceCents = data.priceCents;
    if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    const row = await prisma.reserveDrinkPackage.update({ where: { id }, data: patch });
    return toDrinkPackagePayload(row);
  },

  // Charge the selected drinks packages now (guest present). The same card is
  // saved for no-show protection via setup_future_usage. Server prices the
  // items from the packages — the client never sends prices.
  async createDrinksPaymentIntent(input: unknown): Promise<ReserveDrinksPaymentIntentResponse> {
    const data = reserveDrinksPaymentIntentInputSchema.parse(input);
    if (!stripe) throw new HttpError(503, 'Payments are not configured.');
    const venue = data.venue.trim();
    const ids = data.items.map((item) => item.packageId);
    const packages = await prisma.reserveDrinkPackage.findMany({
      where: { id: { in: ids }, venue, isActive: true }
    });
    const byId = new Map(packages.map((p) => [p.id, p]));
    const lineItems: ReserveDrinksLineItem[] = [];
    for (const item of data.items) {
      const pkg = byId.get(item.packageId);
      if (!pkg) throw new HttpError(400, 'One of the selected drinks is no longer available.');
      lineItems.push({ packageId: pkg.id, name: pkg.name, priceCents: pkg.priceCents, qty: item.qty });
    }
    const amountCents = lineItems.reduce((sum, li) => sum + li.priceCents * li.qty, 0);
    if (amountCents <= 0) throw new HttpError(400, 'Drinks total must be greater than zero.');
    const customer = await stripe.customers.create({
      email: data.guestEmail?.trim() || undefined,
      metadata: { venue, source: 'reserve-drinks' }
    });
    const compact = lineItems.map((li) => ({ p: li.packageId, q: li.qty }));
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'aud',
      customer: customer.id,
      setup_future_usage: 'off_session',
      // Card-only so the Payment Element confirms inline (redirect: 'if_required')
      // without needing a return_url.
      payment_method_types: ['card'],
      description: `Alma Reserve drinks pre-payment · ${venue}`,
      metadata: {
        venue,
        source: 'reserve-drinks',
        drinksItems: JSON.stringify(compact).slice(0, 480)
      }
    });
    if (!intent.client_secret) {
      throw new HttpError(502, 'Stripe did not return a PaymentIntent client secret.');
    }
    return {
      clientSecret: intent.client_secret,
      customerId: customer.id,
      paymentIntentId: intent.id,
      amountCents,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
      lineItems
    };
  },

  // Toggle "drinks redeemed" when the host serves them on arrival.
  async redeemDrinks(actor: AuthUser, id: string): Promise<ReserveReservation> {
    const reservation = await prisma.reserveReservation.findFirst({ where: { id, ...reservationScope(actor, null) } });
    if (!reservation) throw new HttpError(404, 'Reservation not found.');
    if (!reservation.drinksPaidAt) throw new HttpError(409, 'No prepaid drinks on this reservation.');
    const updated = await prisma.reserveReservation.update({
      where: { id },
      data: { drinksRedeemedAt: reservation.drinksRedeemedAt ? null : new Date() },
      include: reserveReservationWithRelationsArgs.include
    });
    return toReservationPayload(updated);
  },

  async createPublicSetupIntent(input: unknown): Promise<ReservePublicSetupIntentResponse> {
    const data = reservePublicSetupIntentInputSchema.parse(input);
    if (!stripe) throw new HttpError(503, 'Card-on-file is not configured.');
    const customer = await stripe.customers.create({
      email: data.guestEmail?.trim() || undefined,
      metadata: {
        venue: data.venue.trim(),
        source: 'reserve-public-widget',
        partySize: data.partySize ? String(data.partySize) : ''
      }
    });
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata: {
        venue: data.venue.trim(),
        source: 'reserve-public-widget'
      }
    });
    if (!setupIntent.client_secret) {
      throw new HttpError(502, 'Stripe did not return a SetupIntent client secret.');
    }
    return {
      clientSecret: setupIntent.client_secret,
      customerId: customer.id,
      setupIntentId: setupIntent.id,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null
    };
  },

  // Manager — charge the saved card-on-file for a no-show. Default fee
  // is $50 per cover (capped at 9 covers = $450) which mirrors the
  // industry norm for casual dining; manager call can override per
  // reservation. Off-session payment intent fires without the guest
  // present; success / failure / requires_action are all stored on
  // the reservation so the manager UI can react.
  async chargeReservationNoShow(actor: AuthUser, id: string, input: unknown): Promise<ReserveNoShowChargeResult> {
    const data = reserveNoShowChargeInputSchema.parse(input ?? {});
    if (!stripe) throw new HttpError(503, 'Card-on-file is not configured.');
    const reservation = await prisma.reserveReservation.findFirst({
      where: { id, ...reservationScope(actor, null) }
    });
    if (!reservation) throw new HttpError(404, 'Reservation not found.');
    if (!reservation.stripeCustomerId || !reservation.stripePaymentMethodId) {
      throw new HttpError(409, 'This reservation has no card on file.');
    }
    if (reservation.noShowFeeChargedAt) {
      throw new HttpError(409, 'No-show fee has already been charged for this reservation.');
    }
    const cappedCovers = Math.min(reservation.covers, 9);
    const amountCents = data.amountCents ?? cappedCovers * DEFAULT_NO_SHOW_FEE_PER_COVER_CENTS;

    // Concurrent-charge guard: claim the reservation by atomically
    // stamping noShowFeePaymentIntentId with a placeholder. A second
    // request hitting this endpoint at the same time will get
    // RecordNotFound on the conditional update and bail before any
    // Stripe call. The Stripe call itself also gets a reservation-
    // scoped idempotency key so a retry can't double-charge even if
    // the first call's response was lost.
    const claimToken = `noshow-pending:${reservation.id}:${Date.now()}`;
    try {
      await prisma.reserveReservation.update({
        where: {
          id: reservation.id,
          noShowFeePaymentIntentId: null
        } as Prisma.ReserveReservationWhereUniqueInput,
        data: { noShowFeePaymentIntentId: claimToken }
      });
    } catch (claimError) {
      if (claimError instanceof Prisma.PrismaClientKnownRequestError && claimError.code === 'P2025') {
        throw new HttpError(409, 'No-show charge already in flight for this reservation.');
      }
      throw claimError;
    }

    try {
      const intent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'aud',
          customer: reservation.stripeCustomerId,
          payment_method: reservation.stripePaymentMethodId,
          off_session: true,
          confirm: true,
          description: `Alma Reserve no-show fee · ${reservation.venue} · ${reservation.startsAt.toISOString()}`,
          metadata: {
            reservationId: reservation.id,
            venue: reservation.venue,
            covers: String(reservation.covers),
            actorId: actor.id ?? '',
            reason: data.reason?.trim() ?? ''
          }
        },
        {
          idempotencyKey: `reserve-noshow:${reservation.id}`
        }
      );
      const status = intent.status === 'succeeded'
        ? 'succeeded'
        : intent.status === 'requires_action' || intent.status === 'requires_confirmation'
          ? 'requires_action'
          : 'failed';
      await prisma.reserveReservation.update({
        where: { id: reservation.id },
        data: {
          status: 'NO_SHOW',
          noShowFeeAmountCents: amountCents,
          noShowFeeChargedAt: status === 'succeeded' ? new Date() : null,
          noShowFeePaymentIntentId: intent.id,
          noShowFeeError: status === 'failed' ? intent.last_payment_error?.message ?? 'Charge failed.' : null
        }
      });
      // Refresh derived guest insights (noShowCount, no-show-risk
      // auto tags) so the marketing / CRM views reflect the new
      // status without waiting for the next reservation update.
      await prisma.$transaction((tx) => refreshGuestInsights(tx, reservation.guestId)).catch(() => undefined);
      await recalculateAutoTagsForGuest(reservation.guestId).catch(() => undefined);
      return {
        reservationId: reservation.id,
        amountCents,
        paymentIntentId: intent.id,
        chargedAt: new Date().toISOString(),
        status,
        errorMessage: status === 'failed' ? intent.last_payment_error?.message ?? null : null
      };
    } catch (error) {
      const message = error instanceof Stripe.errors.StripeError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Stripe charge failed.';
      // Release the claim so a retry from the manager works.
      await prisma.reserveReservation.update({
        where: { id: reservation.id },
        data: {
          noShowFeePaymentIntentId: null,
          noShowFeeAmountCents: amountCents,
          noShowFeeError: message.slice(0, 500)
        }
      });
      throw new HttpError(502, `Could not charge the no-show fee: ${message}`);
    }
  }
};
