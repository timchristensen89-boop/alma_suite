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
  reserveReservationInputSchema,
  reserveReservationUpdateInputSchema,
  reserveTableInputSchema,
  googleReserveIntegrationSettingInputSchema,
  type AuthUser,
  type ReserveGuest,
  type ReservePublicBookingConfirmation,
  type ReserveReservation,
  type ReserveReservationStatus,
  type ReserveServicePeriod,
  type ReservePublicAvailabilitySlot,
  type MarketingSegmentDefinition
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { mailService } from './mail.service.js';
import { buildGuestTimeline, recalculateAutoTagsForGuest } from './marketing.service.js';

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
        isActive: data.isActive
      },
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

  async createReservation(actor: AuthUser, input: unknown) {
    const data = reserveReservationInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue, 'Reserve');
    if (!venue) throw new HttpError(400, 'Reservation venue is required');
    const startsAt = parseDate(data.startsAt, 'Reservation start time');
    const endsAt = parseDate(data.endsAt, 'Reservation end time');
    if (endsAt <= startsAt) throw new HttpError(400, 'Reservation end time must be after start time');
    await Promise.all([ensureTableVenue(data.tableId || null, venue), ensureRuleVenue(data.availabilityRuleId || null, venue)]);

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
          completedAt: VISIT_STATUSES.has(data.status) ? new Date() : null
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
    const [settings, rules, integrations] = await Promise.all([
      prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { venues: true } }),
      prisma.reserveAvailabilityRule.findMany({
        where: { active: true, onlineEnabled: true },
        select: { venue: true, googleReserveEnabled: true }
      }),
      prisma.googleReserveIntegrationSetting.findMany({
        select: { venue: true, enabled: true, merchantId: true, integrationStatus: true }
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
        )
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
          marketingOptIn: data.marketingOptIn
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
      createdAt: reservation.createdAt.toISOString()
    };

    return confirmation;
  }
};
