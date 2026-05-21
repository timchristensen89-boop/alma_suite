import { prisma } from '@alma/db';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  salesActualImportSchema,
  salesActualQuerySchema,
  type AuthUser,
  type ReportsComplianceSummary,
  type ReportsContentSummary,
  type ReportsGiftCardSummary,
  type ReportsMarketingSummary,
  type ReportsOverviewPayload,
  type ReportsRangeDays,
  type ReportsReserveSummary,
  type ReportsStaffSummary,
  type ReportsStockSummary,
  type StocktakeReviewItem
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

const reportsOverviewQuerySchema = z.object({
  range: z.coerce.number().int().optional().default(30),
  venue: z.string().optional().or(z.literal(''))
});

function parseDate(value: string, label: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${label} is invalid`);
  }
  return date;
}

function isAdminActor(actor?: AuthUser | null) {
  return Boolean(actor?.isAdmin || actor?.role === 'ADMIN');
}

function actorVenueScope(actor?: AuthUser | null, requestedVenue?: string | null) {
  const venue = requestedVenue?.trim() || null;
  if (!actor || isAdminActor(actor)) return venue;
  if (!actor.venue) throw new HttpError(403, 'Reports require a venue-scoped manager.');
  if (venue && venue !== actor.venue) {
    throw new HttpError(403, 'Reports are limited to your venue.');
  }
  return actor.venue;
}

function staffProfileScope(actor?: AuthUser | null, requestedVenue?: string | null): Prisma.StaffProfileWhereInput {
  const venue = actorVenueScope(actor, requestedVenue);
  return {
    accountType: 'HUMAN',
    employmentStatus: { not: 'ARCHIVED' },
    ...(venue ? { venue } : {})
  };
}

function stocktakeScope(actor?: AuthUser | null, requestedVenue?: string | null): Prisma.StocktakeWhereInput {
  const venue = actorVenueScope(actor, requestedVenue);
  return venue ? { venue } : {};
}

function salesVenueScope(actor?: AuthUser | null, requestedVenue?: string | null) {
  return actorVenueScope(actor, requestedVenue);
}

function rangeFromInput(input: unknown) {
  const query = reportsOverviewQuerySchema.parse(input ?? {});
  const allowed = new Set([7, 30, 90]);
  const rangeDays = (allowed.has(query.range) ? query.range : 30) as ReportsRangeDays;
  const end = new Date();
  const start = new Date(end.getTime() - rangeDays * 24 * 60 * 60 * 1000);
  return {
    rangeDays,
    requestedVenue: query.venue?.trim() || null,
    start,
    end
  };
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function metadataRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stocktakeLineValue(lines: Array<{ stockValueCents: number | null }>) {
  return lines.reduce((sum, line) => sum + (line.stockValueCents ?? 0), 0);
}

async function venueOnHandLookup(
  rows: Array<{ venue: string | null; lines: Array<{ item: { id: string } | null }> }>
) {
  const venues = Array.from(
    new Set(rows.map((row) => row.venue?.trim()).filter((venue): venue is string => Boolean(venue)))
  );
  const itemIds = Array.from(
    new Set(
      rows.flatMap((row) =>
        row.lines.flatMap((line) => (line.item?.id ? [line.item.id] : []))
      )
    )
  );

  if (venues.length === 0 || itemIds.length === 0) {
    return new Map<string, number | null>();
  }

  const venueRows = await prisma.venueStockItem.findMany({
    where: {
      venue: { in: venues },
      stockItemId: { in: itemIds }
    },
    select: { venue: true, stockItemId: true, onHand: true }
  });

  return new Map(venueRows.map((row) => [`${row.venue}:${row.stockItemId}`, row.onHand] as const));
}

function toStocktakeReviewPayload(row: Prisma.StocktakeGetPayload<{
  include: {
    _count: { select: { lines: true } };
    lines: {
      select: {
        countedQty: true;
        stockValueCents: true;
        item: { select: { id: true; onHand: true } };
      };
    };
  };
}>, venueOnHandByKey?: Map<string, number | null>): StocktakeReviewItem {
  const variance = row.lines.reduce(
    (summary, line) => {
      if (!line.item) return summary;
      const venueOnHand = row.venue ? venueOnHandByKey?.get(`${row.venue}:${line.item.id}`) : undefined;
      const onHand = venueOnHand ?? line.item.onHand;
      const delta = line.countedQty - onHand;
      if (Math.abs(delta) > 0.0001) summary.varianceLineCount += 1;
      summary.totalVarianceQuantity += delta;
      if (delta > 0) summary.positiveVarianceQuantity += delta;
      if (delta < 0) summary.negativeVarianceQuantity += delta;
      return summary;
    },
    {
      varianceLineCount: 0,
      totalVarianceQuantity: 0,
      positiveVarianceQuantity: 0,
      negativeVarianceQuantity: 0
    }
  );

  return {
    id: row.id,
    legacyId: row.legacyId,
    name: row.name,
    venue: row.venue,
    template: row.template,
    countedAt: row.countedAt.toISOString(),
    status: row.status,
    notes: row.notes,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    submittedByUserId: row.submittedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedByUserId: row.reviewedByUserId,
    lineCount: row._count.lines,
    totalValueCents: stocktakeLineValue(row.lines),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...variance
  };
}

async function buildStaffSummary(actor: AuthUser, requestedVenue: string | null, start: Date): Promise<ReportsStaffSummary> {
  const scope = staffProfileScope(actor, requestedVenue);
  const next30 = addDays(startOfTodayUtc(), 30);

  const [
    totalActiveStaff,
    staffByVenueRows,
    missingRequiredCompliance,
    pendingLeaveCount,
    approvedLeaveNext30Days,
    recentManagementEvents
  ] = await Promise.all([
    prisma.staffProfile.count({ where: scope }),
    prisma.staffProfile.groupBy({
      by: ['venue'],
      where: scope,
      _count: { _all: true },
      orderBy: { venue: 'asc' }
    }),
    prisma.staffProfile.count({
      where: {
        ...scope,
        records: { some: { status: { in: ['PENDING', 'EXPIRED'] } } }
      }
    }),
    prisma.staffLeaveRequest.count({
      where: {
        status: 'PENDING',
        staffProfile: scope
      }
    }),
    prisma.staffLeaveRequest.count({
      where: {
        status: 'APPROVED',
        startDate: { lte: next30 },
        endDate: { gte: startOfTodayUtc() },
        staffProfile: scope
      }
    }),
    prisma.staffManagementEvent.findMany({
      where: {
        createdAt: { gte: start },
        staffProfile: scope
      },
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 8
    })
  ]);

  return {
    totalActiveStaff,
    staffByVenue: staffByVenueRows.map((row) => ({
      venue: row.venue ?? 'Unassigned',
      count: row._count._all
    })),
    missingRequiredCompliance,
    pendingLeaveCount,
    approvedLeaveNext30Days,
    recentManagementEvents: recentManagementEvents.map((event) => ({
      ...event,
      metadata: metadataRecord(event.metadata),
      createdAt: event.createdAt.toISOString()
    }))
  };
}

async function buildComplianceSummary(
  actor: AuthUser,
  requestedVenue: string | null
): Promise<ReportsComplianceSummary> {
  const scope = staffProfileScope(actor, requestedVenue);
  const venue = actorVenueScope(actor, requestedVenue);
  const today = startOfTodayUtc();
  const next30 = addDays(today, 30);
  const staffRecordWhere: Prisma.StaffComplianceRecordWhereInput = {
    staffProfile: scope
  };
  const temperatureWhere: Prisma.TemperatureAssetWhereInput = {
    status: 'ACTIVE',
    ...(venue ? { venue } : {})
  };
  const licenceWhere: Prisma.LiquorLicenceWhereInput = {
    status: 'ACTIVE',
    ...(venue ? { venue } : {})
  };

  const [
    pendingStaffRecords,
    expiredStaffRecords,
    expiringStaffRecordsNext30Days,
    outOfRangeTemperatureAssets,
    missingTemperatureReadingsToday,
    activeLicences,
    expiringLicencesNext30Days,
    staffAttentionRecords,
    temperatureAttentionAssets,
    licenceAttentionRows
  ] = await Promise.all([
    prisma.staffComplianceRecord.count({
      where: { ...staffRecordWhere, status: 'PENDING' }
    }),
    prisma.staffComplianceRecord.count({
      where: { ...staffRecordWhere, status: 'EXPIRED' }
    }),
    prisma.staffComplianceRecord.count({
      where: {
        ...staffRecordWhere,
        expiryDate: { gte: today, lte: next30 }
      }
    }),
    prisma.temperatureAsset.count({
      where: { ...temperatureWhere, logs: { some: { status: 'OUT_OF_RANGE' } } }
    }),
    prisma.temperatureAsset.count({
      where: {
        ...temperatureWhere,
        OR: [{ lastReadingAt: null }, { lastReadingAt: { lt: today } }]
      }
    }),
    prisma.liquorLicence.count({ where: licenceWhere }),
    prisma.liquorLicence.count({
      where: { ...licenceWhere, expiryDate: { gte: today, lte: next30 } }
    }),
    prisma.staffComplianceRecord.findMany({
      where: {
        ...staffRecordWhere,
        OR: [
          { status: { in: ['PENDING', 'EXPIRED'] } },
          { expiryDate: { gte: today, lte: next30 } }
        ]
      },
      include: {
        staffProfile: { select: { firstName: true, lastName: true, venue: true } }
      },
      orderBy: [{ expiryDate: 'asc' }, { updatedAt: 'desc' }],
      take: 5
    }),
    prisma.temperatureAsset.findMany({
      where: {
        ...temperatureWhere,
        OR: [{ lastReadingAt: null }, { lastReadingAt: { lt: today } }]
      },
      orderBy: [{ lastReadingAt: 'asc' }, { name: 'asc' }],
      take: 3
    }),
    prisma.liquorLicence.findMany({
      where: { ...licenceWhere, expiryDate: { gte: today, lte: next30 } },
      orderBy: { expiryDate: 'asc' },
      take: 3
    })
  ]);

  return {
    pendingStaffRecords,
    expiredStaffRecords,
    expiringStaffRecordsNext30Days,
    outOfRangeTemperatureAssets,
    missingTemperatureReadingsToday,
    activeLicences,
    expiringLicencesNext30Days,
    topAttentionItems: [
      ...staffAttentionRecords.map((record) => ({
        id: record.id,
        label: `${record.title} · ${record.staffProfile.firstName} ${record.staffProfile.lastName}`,
        venue: record.staffProfile.venue,
        status: record.status,
        dueDate: record.expiryDate?.toISOString() ?? null,
        source: 'STAFF_RECORD' as const
      })),
      ...temperatureAttentionAssets.map((asset) => ({
        id: asset.id,
        label: `${asset.name} reading missing`,
        venue: asset.venue,
        status: asset.lastReadingAt ? 'STALE_READING' : 'MISSING_READING',
        dueDate: asset.lastReadingAt?.toISOString() ?? null,
        source: 'TEMPERATURE' as const
      })),
      ...licenceAttentionRows.map((licence) => ({
        id: licence.id,
        label: `${licence.licenceNumber} · ${licence.licensee}`,
        venue: licence.venue,
        status: licence.status,
        dueDate: licence.expiryDate?.toISOString() ?? null,
        source: 'LICENCE' as const
      }))
    ].slice(0, 10)
  };
}

async function buildStockSummary(
  actor: AuthUser,
  requestedVenue: string | null,
  start: Date
): Promise<ReportsStockSummary> {
  const venue = actorVenueScope(actor, requestedVenue);
  const scope = stocktakeScope(actor, requestedVenue);
  const [
    activeCatalogueItems,
    venueRows,
    stocktakesReadyForReview,
    recentlySubmittedStocktakes,
    highestVarianceRows
  ] = await Promise.all([
    prisma.stockItem.count({
      where: { status: 'ACTIVE' }
    }),
    prisma.venueStockItem.findMany({
      where: {
        ...(venue ? { venue } : {}),
        active: true,
        stockItem: { status: 'ACTIVE' }
      },
      include: { stockItem: { select: { parLevel: true, reorderPoint: true } } }
    }),
    prisma.stocktake.count({
      where: { AND: [scope, { status: 'SUBMITTED', appliedAt: null }] }
    }),
    prisma.stocktake.findMany({
      where: { AND: [scope, { status: 'SUBMITTED', updatedAt: { gte: start } }] },
      include: {
        _count: { select: { lines: true } },
        lines: {
          select: {
            countedQty: true,
            stockValueCents: true,
            item: { select: { id: true, onHand: true } }
          }
        }
      },
      orderBy: [{ submittedAt: 'desc' }, { updatedAt: 'desc' }],
      take: 6
    }),
    prisma.stocktakeLine.findMany({
      where: {
        stocktake: {
          AND: [scope, { status: 'SUBMITTED', updatedAt: { gte: start } }]
        },
        itemId: { not: null }
      },
      include: {
        stocktake: { select: { id: true, name: true, venue: true, submittedAt: true, updatedAt: true } },
        item: { select: { id: true, name: true, onHand: true, unit: true } }
      },
      take: 100
    })
  ]);

  const lowStockCount = venueRows.filter((row) => {
    const threshold = row.reorderPoint ?? row.parLevel ?? row.stockItem.parLevel;
    return row.onHand !== null && threshold > 0 && row.onHand <= threshold;
  }).length;
  const outOfStockCount = venueRows.filter((row) => row.onHand !== null && row.onHand <= 0).length;
  const venueStockOnHandByKey = new Map(
    venueRows.map((row) => [`${row.venue}:${row.stockItemId}`, row.onHand] as const)
  );
  const venueStockItemIds = new Set(venueRows.map((row) => row.stockItemId));
  const reviewVenueOnHandByKey = await venueOnHandLookup(recentlySubmittedStocktakes);

  const highestVarianceLines = highestVarianceRows
    .filter((line) => line.item)
    .map((line) => {
      const venueOnHand =
        line.stocktake.venue && line.item?.id
          ? venueStockOnHandByKey.get(`${line.stocktake.venue}:${line.item.id}`)
          : undefined;
      const onHand = venueOnHand ?? line.item?.onHand ?? 0;
      return {
        stocktakeId: line.stocktake.id,
        stocktakeName: line.stocktake.name,
        venue: line.stocktake.venue,
        itemName: line.item?.name ?? line.label,
        countedQty: line.countedQty,
        onHand,
        unit: line.unit ?? line.item?.unit ?? null,
        variance: line.countedQty - onHand,
        submittedAt: line.stocktake.submittedAt?.toISOString() ?? line.stocktake.updatedAt.toISOString()
      };
    })
    .filter((line) => Math.abs(line.variance) > 0.0001)
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    .slice(0, 8);

  return {
    activeStockItems: activeCatalogueItems,
    activeCatalogueItems,
    venueStockItems: venueStockItemIds.size,
    unconfiguredVenueStockItems: venue ? Math.max(activeCatalogueItems - venueStockItemIds.size, 0) : 0,
    lowStockCount,
    outOfStockCount,
    stocktakesReadyForReview,
    recentlySubmittedStocktakes: recentlySubmittedStocktakes.map((row) =>
      toStocktakeReviewPayload(row, reviewVenueOnHandByKey)
    ),
    highestVarianceLines,
    stockItemsVenueScoped: true
  };
}

async function buildReserveSummary(
  actor: AuthUser,
  requestedVenue: string | null,
  start: Date,
  end: Date
): Promise<ReportsReserveSummary> {
  const venue = actorVenueScope(actor, requestedVenue);
  const today = startOfTodayUtc();
  const tomorrow = addDays(today, 1);
  const reservationWhere: Prisma.ReserveReservationWhereInput = venue ? { venue } : {};
  const [bookingsToday, coversTodayRows, upcomingBookings, cancellations, noShows, newGuests] = await Promise.all([
    prisma.reserveReservation.count({
      where: {
        ...reservationWhere,
        startsAt: { gte: today, lt: tomorrow },
        status: { not: 'CANCELLED' }
      }
    }),
    prisma.reserveReservation.aggregate({
      _sum: { covers: true },
      where: {
        ...reservationWhere,
        startsAt: { gte: today, lt: tomorrow },
        status: { in: ['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED'] }
      }
    }),
    prisma.reserveReservation.count({
      where: {
        ...reservationWhere,
        startsAt: { gte: today, lte: addDays(today, 30) },
        status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] }
      }
    }),
    prisma.reserveReservation.count({
      where: {
        ...reservationWhere,
        updatedAt: { gte: start, lte: end },
        status: 'CANCELLED'
      }
    }),
    prisma.reserveReservation.count({
      where: {
        ...reservationWhere,
        updatedAt: { gte: start, lte: end },
        status: 'NO_SHOW'
      }
    }),
    prisma.reserveGuest.count({
      where: {
        ...(venue ? { OR: [{ venue }, { reservations: { some: { venue } } }] } : {}),
        createdAt: { gte: start, lte: end }
      }
    })
  ]);

  return {
    bookingsToday,
    coversToday: coversTodayRows._sum.covers ?? 0,
    upcomingBookings,
    cancellations,
    noShows,
    newGuests
  };
}

async function buildMarketingSummary(
  actor: AuthUser,
  requestedVenue: string | null
): Promise<ReportsMarketingSummary> {
  const venue = actorVenueScope(actor, requestedVenue);
  const guestWhere: Prisma.ReserveGuestWhereInput = venue ? { OR: [{ venue }, { reservations: { some: { venue } } }] } : {};
  const campaignWhere: Prisma.MarketingCampaignWhereInput = venue ? { venue } : {};
  const [totalGuests, optedInGuests, unsubscribedGuests, repeatVisitors, campaignDrafts, simulatedSends] = await Promise.all([
    prisma.reserveGuest.count({ where: guestWhere }),
    prisma.reserveGuest.count({ where: { ...guestWhere, marketingOptIn: true, emailUnsubscribedAt: null } }),
    prisma.reserveGuest.count({
      where: {
        ...guestWhere,
        OR: [{ emailUnsubscribedAt: { not: null } }, { smsUnsubscribedAt: { not: null } }]
      }
    }),
    prisma.reserveGuest.count({ where: { ...guestWhere, totalVisits: { gte: 2 } } }),
    prisma.marketingCampaign.count({ where: { ...campaignWhere, status: 'DRAFT' } }),
    prisma.marketingCampaignRecipient.count({
      where: {
        status: 'SIMULATED',
        campaign: campaignWhere
      }
    })
  ]);

  return {
    totalGuests,
    optedInGuests,
    unsubscribedGuests,
    repeatVisitors,
    campaignDrafts,
    simulatedSends
  };
}

async function buildContentSummary(
  actor: AuthUser,
  requestedVenue: string | null
): Promise<ReportsContentSummary> {
  const venue = actorVenueScope(actor, requestedVenue);
  const where = venue ? { venue } : {};
  const today = startOfTodayUtc();
  const nextWeek = addDays(today, 7);
  const [scheduledPostsThisWeek, postsNeedingApproval, failedSimulatedPublishAttempts, setupRequiredSocialAccounts, assetsUploaded] =
    await Promise.all([
      prisma.marketingContentPost.count({
        where: {
          ...where,
          scheduledAt: { gte: today, lte: nextWeek },
          status: { in: ['APPROVED', 'SCHEDULED', 'PUBLISHING'] }
        }
      }),
      prisma.marketingContentPost.count({ where: { ...where, status: 'NEEDS_REVIEW' } }),
      prisma.marketingContentPublishAttempt.count({
        where: {
          status: { in: ['FAILED', 'SKIPPED'] },
          mode: 'SIMULATION',
          post: where
        }
      }),
      prisma.marketingSocialAccount.count({
        where: {
          ...where,
          status: { in: ['SETUP_REQUIRED', 'ERROR', 'EXPIRED'] }
        }
      }),
      prisma.marketingContentAsset.count({ where: { ...where, status: { not: 'ARCHIVED' } } })
    ]);

  return {
    scheduledPostsThisWeek,
    postsNeedingApproval,
    failedSimulatedPublishAttempts,
    setupRequiredSocialAccounts,
    assetsUploaded
  };
}

async function buildGiftCardSummary(): Promise<ReportsGiftCardSummary> {
  const [pendingOrders, pendingAmount, fulfilledOrders] = await Promise.all([
    prisma.giftCard.count({ where: { status: 'PENDING_PAYMENT' } }),
    prisma.giftCard.aggregate({
      _sum: { initialValueCents: true },
      where: { status: 'PENDING_PAYMENT' }
    }),
    prisma.giftCard.count({ where: { status: { in: ['ACTIVE', 'REDEEMED'] } } })
  ]);

  return {
    pendingOrders,
    totalPendingAmountCents: pendingAmount._sum.initialValueCents ?? 0,
    fulfilledOrders
  };
}

export const reportsService = {
  async overview(input: unknown, actor: AuthUser): Promise<ReportsOverviewPayload> {
    const { rangeDays, requestedVenue, start, end } = rangeFromInput(input);
    const venue = actorVenueScope(actor, requestedVenue);
    const [staff, compliance, stock, reserve, marketing, content, giftCards] = await Promise.all([
      buildStaffSummary(actor, requestedVenue, start),
      buildComplianceSummary(actor, requestedVenue),
      buildStockSummary(actor, requestedVenue, start),
      buildReserveSummary(actor, requestedVenue, start, end),
      buildMarketingSummary(actor, requestedVenue),
      buildContentSummary(actor, requestedVenue),
      buildGiftCardSummary()
    ]);

    return {
      generatedAt: new Date().toISOString(),
      rangeDays,
      start: start.toISOString(),
      end: end.toISOString(),
      scope: {
        venue,
        admin: isAdminActor(actor)
      },
      staff,
      compliance,
      stock,
      reserve,
      marketing,
      content,
      giftCards
    };
  },

  async staff(input: unknown, actor: AuthUser) {
    const { requestedVenue, start } = rangeFromInput(input);
    return buildStaffSummary(actor, requestedVenue, start);
  },

  async compliance(input: unknown, actor: AuthUser) {
    const { requestedVenue } = rangeFromInput(input);
    return buildComplianceSummary(actor, requestedVenue);
  },

  async stock(input: unknown, actor: AuthUser) {
    const { requestedVenue, start } = rangeFromInput(input);
    return buildStockSummary(actor, requestedVenue, start);
  },

  async listActualSales(input: unknown, actor?: AuthUser) {
    const data = salesActualQuerySchema.parse(input);
    const start = parseDate(data.start, 'Sales start date');
    const end = parseDate(data.end, 'Sales end date');
    if (end <= start) throw new HttpError(400, 'Sales end date must be after the start date');
    const venue = salesVenueScope(actor, data.venue);

    const entries = await prisma.salesActualEntry.findMany({
      where: {
        serviceDate: { gte: start, lt: end },
        ...(venue ? { venue } : {})
      },
      orderBy: [{ serviceDate: 'asc' }, { venue: 'asc' }, { source: 'asc' }]
    });

    const byVenue = Array.from(
      entries.reduce((map, entry) => {
        const current = map.get(entry.venue) ?? { venue: entry.venue, salesCents: 0, days: new Set<string>() };
        current.salesCents += entry.salesCents;
        current.days.add(entry.serviceDate.toISOString().slice(0, 10));
        map.set(entry.venue, current);
        return map;
      }, new Map<string, { venue: string; salesCents: number; days: Set<string> }>())
        .values()
    ).map((row) => ({ venue: row.venue, salesCents: row.salesCents, days: row.days.size }));

    return {
      entries: entries.map((entry) => ({
        ...entry,
        serviceDate: entry.serviceDate.toISOString(),
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString()
      })),
      totalSalesCents: entries.reduce((sum, entry) => sum + entry.salesCents, 0),
      byVenue
    };
  },

  async importActualSales(input: unknown, actor?: AuthUser) {
    const data = salesActualImportSchema.parse(input);
    let imported = 0;

    for (const row of data.rows) {
      const venue = salesVenueScope(actor, row.venue);
      if (!venue) throw new HttpError(400, 'Sales row venue is required');
      const serviceDate = parseDate(row.serviceDate, 'Sales service date');
      const externalId = row.externalId?.trim() || `${venue}:${serviceDate.toISOString().slice(0, 10)}:${data.source}`;
      await prisma.salesActualEntry.upsert({
        where: {
          venue_serviceDate_source_externalId: {
            venue,
            serviceDate,
            source: data.source.trim(),
            externalId
          }
        },
        create: {
          venue,
          serviceDate,
          salesCents: row.salesCents,
          source: data.source.trim(),
          externalId,
          notes: row.notes?.trim() || null,
          importedById: actor?.id || null
        },
        update: {
          salesCents: row.salesCents,
          notes: row.notes?.trim() || null,
          importedById: actor?.id || null
        }
      });
      imported += 1;
    }

    return { imported };
  },

  async deleteActualSalesEntry(id: string, actor?: AuthUser) {
    const existing = await prisma.salesActualEntry.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Sales entry not found');
    salesVenueScope(actor, existing.venue);
    await prisma.salesActualEntry.delete({ where: { id } });
    return { ok: true };
  },

  async clearActualSales(input: unknown, actor?: AuthUser) {
    const data = salesActualQuerySchema.extend({
      source: z.string().optional().or(z.literal(''))
    }).parse(input);
    const start = parseDate(data.start, 'Sales start date');
    const end = parseDate(data.end, 'Sales end date');
    if (end <= start) throw new HttpError(400, 'Sales end date must be after the start date');
    const venue = salesVenueScope(actor, data.venue);

    const deleted = await prisma.salesActualEntry.deleteMany({
      where: {
        serviceDate: { gte: start, lt: end },
        ...(venue ? { venue } : {}),
        ...(data.source ? { source: data.source } : {})
      }
    });

    return { deleted: deleted.count };
  }
};
