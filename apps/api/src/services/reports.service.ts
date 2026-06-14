import { prisma, computeActualCogs, type ActualCogs } from '@alma/db';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { staffCostingRate, splitOvertimeHours, costForRate, weeklyFixedCostCents, salariedVenueAllocations, staffPayRateSelect } from '../lib/staff-pay-rates.js';
import {
  salesActualImportSchema,
  salesActualQuerySchema,
  reportsMenuProfitabilityQuerySchema,
  reportsMonthlyRecapQuerySchema,
  reportsMonthlyRecapEmailInputSchema,
  type AuthUser,
  type MonthlyRecapPayload,
  type MonthlyRecapPeriod,
  type MonthlyRecapRecommendation,
  type MonthlyRecapStockQuality,
  type ReportsMenuProfitabilityPayload,
  type ReportsMenuProfitabilityRow,
  type ReportsComplianceSummary,
  type ReportsContentSummary,
  type ReportsGiftCardSummary,
  type ReportsMarketingSummary,
  type ReportsOverviewPayload,
  type ReportsPrimeCostPayload,
  type ReportsRangeDays,
  type ReportsReserveSummary,
  type ReportsStaffSummary,
  type ReportsStockSummary,
  type SalesItemActualSummary,
  type StocktakeReviewItem
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { mailService } from './mail.service.js';
import { integrationService } from './integration.service.js';
import { deputyService } from './deputy.service.js';
import { configuredSuperRateFraction } from './settings.service.js';

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

function workedHours(entry: { clockInAt: Date; clockOutAt: Date; breakMinutes: number }) {
  const gross = (entry.clockOutAt.getTime() - entry.clockInAt.getTime()) / (1000 * 60 * 60);
  return Math.max(0, gross - (entry.breakMinutes ?? 0) / 60);
}

function rosterHours(entry: { startsAt: Date; endsAt: Date; breakMinutes: number }) {
  const gross = (entry.endsAt.getTime() - entry.startsAt.getTime()) / (1000 * 60 * 60);
  return Math.max(0, gross - (entry.breakMinutes ?? 0) / 60);
}

function payRateCents(profile: { payRateCents: number | null; trainingPayRateCents: number | null } | null | undefined) {
  return profile?.trainingPayRateCents ?? profile?.payRateCents ?? 0;
}

function pct(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

function accountKeyFromSalesSource(source: string): 'primary' | 'secondary' | 'unknown' {
  if (source === 'square-item:primary') return 'primary';
  if (source === 'square-item:secondary') return 'secondary';
  return 'unknown';
}

function normaliseMenuText(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
}

function recipeCostCents(recipe: { estimatedCost: number } | null | undefined) {
  if (!recipe || recipe.estimatedCost <= 0) return null;
  return Math.round(recipe.estimatedCost * 100);
}

function primeQuality(input: { sales: number; wages: number; cogs: number; rosterEstimate: number }) {
  const missing = [
    ...(input.sales > 0 ? [] : ['sales']),
    ...(input.wages > 0 || input.rosterEstimate > 0 ? [] : ['wages']),
    ...(input.cogs > 0 ? [] : ['COGS'])
  ];
  if (!missing.length && input.wages > 0) return { sourceQuality: 'complete_current' as const, missing };
  if (missing.includes('sales')) return { sourceQuality: 'missing_sales' as const, missing };
  if (missing.includes('COGS')) return { sourceQuality: 'missing_cogs' as const, missing };
  if (missing.includes('wages')) return { sourceQuality: 'missing_wages' as const, missing };
  return { sourceQuality: 'estimated_wages' as const, missing };
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
      if (!line.item || line.countedQty == null) return summary;
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
        variance: line.countedQty == null ? null : line.countedQty - onHand,
        submittedAt: line.stocktake.submittedAt?.toISOString() ?? line.stocktake.updatedAt.toISOString()
      };
    })
    .filter((line) => line.variance != null && Math.abs(line.variance) > 0.0001)
    .sort((a, b) => Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0))
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

// ── Monthly recap helpers ───────────────────────────────────────────────────
function recapMonthLabel(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(y, m - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}
// AU financial year starts 1 July.
function financialYearStart(date: Date): Date {
  const year = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
  return new Date(year, 6, 1);
}
function recapMoney(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-AU')}`;
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}

async function recapWageCents(venue: string | null, start: Date, end: Date): Promise<number> {
  const superRate = await configuredSuperRateFraction();
  const [timesheets, salariedStaff] = await Promise.all([
    prisma.timesheet.findMany({
      where: {
        workDate: { gte: start, lt: end },
        status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'EXPORTED'] },
        ...(venue ? { venue } : {}),
        staffProfile: { accountType: 'HUMAN' }
      },
      include: { staffProfile: { select: staffPayRateSelect } }
    }),
    // All active salaried staff regardless of home venue — their full weekly
    // salary is split across venues by rostered hours below (salaried staff
    // rarely clock in, so roster is the reliable venue signal).
    prisma.staffProfile.findMany({
      where: {
        accountType: 'HUMAN',
        mergedIntoStaffProfileId: null,
        employmentStatus: 'ACTIVE',
        payProfile: { isNot: null }
      },
      select: { id: true, venue: true, ...staffPayRateSelect }
    })
  ]);
  const weekHours = new Map<string, number>();
  let cents = 0;
  for (const entry of timesheets) {
    const hours = workedHours(entry);
    const rate = staffCostingRate(entry.staffProfile, superRate);
    const split = splitOvertimeHours(weekHours, entry.staffProfileId, entry.workDate, hours, rate.appliesOvertime);
    // Salaried: only overtime is hour-costed; their weekly salary is added below.
    cents += rate.appliesOvertime ? costForRate({ ...rate, ordinaryRateCents: 0 }, split) : costForRate(rate, split);
  }
  // Full weekly salary + super for every active salaried full-timer, every week,
  // attributed to this venue by the fraction of their rostered hours worked here
  // (full salary when venue is null / org-wide).
  const periodWeeks = Math.max(0, (end.getTime() - start.getTime()) / (7 * 86_400_000));
  const salariedIds = salariedStaff.map((p) => p.id);
  const rosterHoursByStaffVenue = new Map<string, Map<string, number>>();
  if (salariedIds.length > 0) {
    const shifts = await prisma.rosterShift.findMany({
      where: {
        startsAt: { lt: end },
        endsAt: { gt: start },
        status: { not: 'CANCELLED' },
        staffProfileId: { in: salariedIds },
        staffProfile: { accountType: 'HUMAN', mergedIntoStaffProfileId: null }
      },
      select: { staffProfileId: true, venue: true, startsAt: true, endsAt: true, breakMinutes: true, staffProfile: { select: { venue: true } } }
    });
    for (const shift of shifts) {
      const v = shift.venue?.trim() || shift.staffProfile.venue?.trim() || 'Unassigned';
      const h = rosterHours(shift);
      const m = rosterHoursByStaffVenue.get(shift.staffProfileId) ?? new Map<string, number>();
      m.set(v, (m.get(v) ?? 0) + h);
      rosterHoursByStaffVenue.set(shift.staffProfileId, m);
    }
  }
  for (const profile of salariedStaff) {
    const fixedForPeriod = Math.round(weeklyFixedCostCents(staffCostingRate(profile, superRate)) * periodWeeks);
    if (fixedForPeriod <= 0) continue;
    const allocations = salariedVenueAllocations(
      rosterHoursByStaffVenue.get(profile.id) ?? new Map<string, number>(),
      profile.venue?.trim() || 'Unassigned'
    );
    const fraction = venue
      ? allocations.filter((a) => a.venue === venue).reduce((sum, a) => sum + a.fraction, 0)
      : 1;
    if (fraction <= 0) continue;
    cents += Math.round(fixedForPeriod * fraction);
  }
  return cents;
}

async function recapPeriod(venue: string | null, start: Date, end: Date, label: string): Promise<MonthlyRecapPeriod> {
  // COGS comes from the suite-wide canonical helper (ex-GST, finalised stock
  // purchases, stocktake-bounded with a purchases-only fallback) so the Recap
  // agrees with the Stock dashboard and Prime Cost report to the cent.
  const [salesAgg, wageCents, cogs] = await Promise.all([
    prisma.salesActualEntry.aggregate({ where: { serviceDate: { gte: start, lt: end }, ...(venue ? { venue } : {}) }, _sum: { salesCents: true } }),
    recapWageCents(venue, start, end),
    computeActualCogs({ venue, start, end })
  ]);
  const salesCents = salesAgg._sum.salesCents ?? 0;
  const { cogsCents, purchasesCents, openingStockCents, closingStockCents, quality: stockQuality } = cogs;
  const primeCostCents = wageCents + cogsCents;
  const pct = (n: number) => (salesCents > 0 ? Math.round((n / salesCents) * 1000) / 10 : null);
  return {
    label, start: start.toISOString(), end: end.toISOString(),
    salesCents, wageCents, openingStockCents, closingStockCents, purchasesCents, cogsCents, primeCostCents,
    wagePct: pct(wageCents), cogsPct: pct(cogsCents), primePct: pct(primeCostCents), stockQuality
  };
}

function recapRecommendations(
  month: MonthlyRecapPeriod,
  priorYear: MonthlyRecapPeriod,
  targets: { wagePct: number; cogsPct: number; primePct: number }
): MonthlyRecapRecommendation[] {
  const recs: MonthlyRecapRecommendation[] = [];
  const fmt = (n: number | null) => (n == null ? '—' : `${n.toFixed(1)}%`);
  if (month.salesCents === 0) {
    return [{ tone: 'info', title: 'No sales recorded for this month', detail: 'Import Square sales for the period to compute wage %, COGS % and prime cost.' }];
  }
  if (month.primePct != null) {
    if (month.primePct > targets.primePct) {
      recs.push({ tone: 'danger', title: `Prime cost ${fmt(month.primePct)} — above the ${targets.primePct}% target`, detail: `Wages ${fmt(month.wagePct)} + COGS ${fmt(month.cogsPct)}. Tighten the larger of the two to bring prime cost under ${targets.primePct}%.` });
    } else {
      recs.push({ tone: 'positive', title: `Prime cost ${fmt(month.primePct)} — within the ${targets.primePct}% target`, detail: 'Healthy — hold rostering and purchasing discipline.' });
    }
  }
  if (month.wagePct != null && month.wagePct > targets.wagePct) {
    recs.push({ tone: 'warning', title: `Wages ${fmt(month.wagePct)} of sales — over ${targets.wagePct}%`, detail: 'Review rostering on quiet shifts and overtime; the Staff Costing report breaks this down by venue and role.' });
  }
  if (month.cogsPct != null && month.cogsPct > targets.cogsPct) {
    recs.push({ tone: 'warning', title: `COGS ${fmt(month.cogsPct)} of sales — over ${targets.cogsPct}%`, detail: 'Check supplier price movement and waste, and confirm the closing stocktake is locked for an accurate figure.' });
  }
  if (priorYear.salesCents > 0) {
    const salesPct = Math.round(((month.salesCents - priorYear.salesCents) / priorYear.salesCents) * 1000) / 10;
    recs.push({ tone: salesPct >= 0 ? 'positive' : 'info', title: `Sales ${salesPct >= 0 ? 'up' : 'down'} ${Math.abs(salesPct).toFixed(1)}% vs last year`, detail: `${recapMoney(month.salesCents)} this year vs ${recapMoney(priorYear.salesCents)} the same month last year.` });
    if (month.primePct != null && priorYear.primePct != null) {
      const primeDelta = Math.round((month.primePct - priorYear.primePct) * 10) / 10;
      if (Math.abs(primeDelta) >= 1) {
        recs.push({ tone: primeDelta > 0 ? 'warning' : 'positive', title: `Prime cost ${primeDelta > 0 ? 'up' : 'down'} ${Math.abs(primeDelta).toFixed(1)}pts vs last year`, detail: `${fmt(priorYear.primePct)} last year → ${fmt(month.primePct)} now.` });
      }
    }
  }
  if (month.stockQuality !== 'complete') {
    recs.push({ tone: 'info', title: 'COGS is estimated (no stocktake bounds)', detail: 'No locked stocktake found at the period boundaries, so COGS uses purchases only. Lock an opening and closing stocktake for a true opening + purchases − closing figure.' });
  }
  return recs;
}

function renderMonthlyRecapText(recap: MonthlyRecapPayload): string {
  const line = (p: MonthlyRecapPeriod) => `${p.label}: Sales ${recapMoney(p.salesCents)} | Wages ${recapMoney(p.wageCents)} (${p.wagePct ?? '—'}%) | COGS ${recapMoney(p.cogsCents)} (${p.cogsPct ?? '—'}%) | Prime ${recapMoney(p.primeCostCents)} (${p.primePct ?? '—'}%)`;
  return [
    `Monthly Recap — ${recap.monthLabel}${recap.venue ? ` · ${recap.venue}` : ''}`,
    '', 'THIS MONTH', line(recap.monthCurrent), 'SAME MONTH LAST YEAR', line(recap.monthPriorYear),
    '', recap.ytdLabel.toUpperCase(), line(recap.ytdCurrent), 'PRIOR FY TO DATE', line(recap.ytdPriorYear),
    '', 'RECOMMENDATIONS', ...recap.recommendations.map((r) => `- ${r.title}: ${r.detail}`)
  ].join('\n');
}

function renderMonthlyRecapHtml(recap: MonthlyRecapPayload): string {
  const row = (p: MonthlyRecapPeriod) => `<tr><td style="padding:6px 8px">${escapeHtml(p.label)}</td><td style="padding:6px 8px;text-align:right">${recapMoney(p.salesCents)}</td><td style="padding:6px 8px;text-align:right">${recapMoney(p.wageCents)} (${p.wagePct ?? '—'}%)</td><td style="padding:6px 8px;text-align:right">${recapMoney(p.cogsCents)} (${p.cogsPct ?? '—'}%)</td><td style="padding:6px 8px;text-align:right"><strong>${recapMoney(p.primeCostCents)} (${p.primePct ?? '—'}%)</strong></td></tr>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2a1e;max-width:700px">
  <h2 style="font-family:Georgia,serif">Monthly Recap — ${escapeHtml(recap.monthLabel)}${recap.venue ? ` · ${escapeHtml(recap.venue)}` : ''}</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e3ddd2">
    <thead><tr style="background:#f5f1e8;text-align:left"><th style="padding:6px 8px">Period</th><th style="padding:6px 8px;text-align:right">Sales</th><th style="padding:6px 8px;text-align:right">Wages</th><th style="padding:6px 8px;text-align:right">COGS</th><th style="padding:6px 8px;text-align:right">Prime</th></tr></thead>
    <tbody>${row(recap.monthCurrent)}${row(recap.monthPriorYear)}${row(recap.ytdCurrent)}${row(recap.ytdPriorYear)}</tbody>
  </table>
  <h3>Recommendations</h3>
  <ul style="font-size:13px;line-height:1.5">${recap.recommendations.map((r) => `<li><strong>${escapeHtml(r.title)}</strong> — ${escapeHtml(r.detail)}</li>`).join('')}</ul>
  <p style="color:#8a8a8a;font-size:11px">Generated ${new Date(recap.generatedAt).toLocaleString('en-AU')}. COGS = opening stock + purchases − closing stock. Targets: wages ${recap.targets.wagePct}% / COGS ${recap.targets.cogsPct}% / prime ${recap.targets.primePct}% of sales.</p>
</div>`;
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

  async primeCost(input: unknown, actor?: AuthUser): Promise<ReportsPrimeCostPayload> {
    const data = salesActualQuerySchema.parse(input);
    const start = parseDate(data.start, 'Prime cost start date');
    const end = parseDate(data.end, 'Prime cost end date');
    if (end <= start) throw new HttpError(400, 'Prime cost end date must be after the start date');
    const venue = actorVenueScope(actor, data.venue);
    const superRate = await configuredSuperRateFraction();

    const [salesEntries, timesheets, rosterShifts, invoiceLines, wastageRows, activeStaff] = await Promise.all([
      prisma.salesActualEntry.findMany({
        where: { serviceDate: { gte: start, lt: end }, ...(venue ? { venue } : {}) }
      }),
      prisma.timesheet.findMany({
        where: {
          workDate: { gte: start, lt: end },
          status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'EXPORTED'] },
          ...(venue ? { venue } : {}),
          staffProfile: { accountType: 'HUMAN' }
        },
        include: { staffProfile: { select: { venue: true, ...staffPayRateSelect } } }
      }),
      prisma.rosterShift.findMany({
        where: {
          startsAt: { lt: end },
          endsAt: { gt: start },
          status: { not: 'CANCELLED' },
          ...(venue ? { venue } : {}),
          staffProfile: { accountType: 'HUMAN' }
        },
        include: { staffProfile: { select: { venue: true, ...staffPayRateSelect } } }
      }),
      prisma.supplierInvoiceLine.findMany({
        where: {
          itemId: { not: null },
          invoice: {
            invoiceDate: { gte: start, lt: end },
            ...(venue ? { venue } : {})
          }
        },
        include: { invoice: { select: { venue: true } } }
      }),
      prisma.stockWastageRecord.findMany({
        where: { wastedAt: { gte: start, lt: end }, ...(venue ? { venue } : {}) }
      }),
      // All active salaried staff regardless of home venue — their full weekly
      // salary is split across venue rows below by rostered hours (salaried staff
      // rarely clock in, so roster is the reliable venue signal).
      prisma.staffProfile.findMany({
        where: {
          accountType: 'HUMAN',
          mergedIntoStaffProfileId: null,
          employmentStatus: 'ACTIVE',
          payProfile: { isNot: null }
        },
        select: { id: true, venue: true, ...staffPayRateSelect }
      })
    ]);

    const rows = new Map<string, {
      venue: string;
      salesCents: number;
      salesDays: Set<string>;
      wageCents: number;
      approvedWageCents: number;
      rosterWageEstimateCents: number;
      invoiceCogsCents: number;
      wastageCents: number;
      timesheetHours: number;
      rosterHours: number;
    }>();
    const rowFor = (rowVenue: string | null | undefined) => {
      const key = rowVenue?.trim() || 'Unassigned';
      const current = rows.get(key) ?? {
        venue: key,
        salesCents: 0,
        salesDays: new Set<string>(),
        wageCents: 0,
        approvedWageCents: 0,
        rosterWageEstimateCents: 0,
        invoiceCogsCents: 0,
        wastageCents: 0,
        timesheetHours: 0,
        rosterHours: 0
      };
      rows.set(key, current);
      return current;
    };

    for (const entry of salesEntries) {
      const row = rowFor(entry.venue);
      row.salesCents += entry.salesCents;
      row.salesDays.add(entry.serviceDate.toISOString().slice(0, 10));
    }
    // Cumulative weekly hours per staff for overtime (salaried full-timers >45h/wk).
    const actualWeekHours = new Map<string, number>();
    const scheduledWeekHours = new Map<string, number>();
    for (const entry of timesheets) {
      const row = rowFor(entry.venue || entry.staffProfile.venue);
      const hours = workedHours(entry);
      const rate = staffCostingRate(entry.staffProfile, superRate);
      const split = splitOvertimeHours(actualWeekHours, entry.staffProfileId, entry.workDate, hours, rate.appliesOvertime);
      // Salaried: only overtime is hour-costed; their weekly salary is added below.
      const cost = rate.appliesOvertime ? costForRate({ ...rate, ordinaryRateCents: 0 }, split) : costForRate(rate, split);
      row.timesheetHours += hours;
      row.wageCents += cost;
      if (entry.status === 'APPROVED' || entry.status === 'EXPORTED') row.approvedWageCents += cost;
    }
    for (const shift of rosterShifts) {
      const row = rowFor(shift.venue || shift.staffProfile.venue);
      const hours = rosterHours(shift);
      const rate = staffCostingRate(shift.staffProfile, superRate);
      const split = splitOvertimeHours(scheduledWeekHours, shift.staffProfileId, shift.startsAt, hours, rate.appliesOvertime);
      row.rosterHours += hours;
      row.rosterWageEstimateCents += rate.appliesOvertime ? costForRate({ ...rate, ordinaryRateCents: 0 }, split) : costForRate(rate, split);
    }
    // Salaried full-timers: full weekly salary + super every week, regardless of
    // timesheets — split across venue rows by rostered hours (salaried staff
    // rarely clock in), falling back to their home venue when never rostered.
    // The split needs each staffer's roster across ALL venues (so the fraction is
    // right even in a venue-filtered report), hence a dedicated unscoped query.
    const primePeriodWeeks = Math.max(0, (end.getTime() - start.getTime()) / (7 * 86_400_000));
    const salariedIds = activeStaff.map((p) => p.id);
    const salariedRosterHoursByStaffVenue = new Map<string, Map<string, number>>();
    if (salariedIds.length > 0) {
      const salariedShifts = await prisma.rosterShift.findMany({
        where: {
          startsAt: { lt: end },
          endsAt: { gt: start },
          status: { not: 'CANCELLED' },
          staffProfileId: { in: salariedIds },
          staffProfile: { accountType: 'HUMAN', mergedIntoStaffProfileId: null }
        },
        select: { staffProfileId: true, venue: true, startsAt: true, endsAt: true, breakMinutes: true, staffProfile: { select: { venue: true } } }
      });
      for (const shift of salariedShifts) {
        const v = shift.venue?.trim() || shift.staffProfile.venue?.trim() || 'Unassigned';
        const h = rosterHours(shift);
        const m = salariedRosterHoursByStaffVenue.get(shift.staffProfileId) ?? new Map<string, number>();
        m.set(v, (m.get(v) ?? 0) + h);
        salariedRosterHoursByStaffVenue.set(shift.staffProfileId, m);
      }
    }
    for (const profile of activeStaff) {
      const fixed = Math.round(weeklyFixedCostCents(staffCostingRate(profile, superRate)) * primePeriodWeeks);
      if (fixed <= 0) continue;
      const allocations = salariedVenueAllocations(
        salariedRosterHoursByStaffVenue.get(profile.id) ?? new Map<string, number>(),
        profile.venue?.trim() || 'Unassigned'
      );
      const applied = venue ? allocations.filter((a) => a.venue === venue) : allocations;
      for (const alloc of applied) {
        const cents = Math.round(fixed * alloc.fraction);
        if (cents <= 0) continue;
        const row = rowFor(alloc.venue);
        row.wageCents += cents;
        row.approvedWageCents += cents;
        row.rosterWageEstimateCents += cents;
      }
    }
    // invoiceCogsCents / wastageCents stay populated as informational context
    // (what was invoiced, what was wasted) — but COGS itself comes from the
    // canonical helper, NOT their sum, so Prime Cost agrees with the Recap and
    // Stock dashboard to the cent.
    for (const line of invoiceLines) rowFor(line.invoice.venue).invoiceCogsCents += Math.max(0, line.lineAmountCents);
    for (const wastage of wastageRows) rowFor(wastage.venue).wastageCents += Math.max(0, wastage.costImpactCents ?? 0);

    // Canonical COGS per venue. Real venues query their own tag; any residual
    // (untagged invoices) is folded into 'Unassigned' so the per-venue rows
    // still sum to the suite-wide canonical total.
    const rowKeys = Array.from(rows.keys());
    const realVenueKeys = rowKeys.filter((key) => key !== 'Unassigned');
    const [allVenuesCogs, ...realVenueCogs] = await Promise.all([
      computeActualCogs({ venue: venue ?? null, start, end }),
      ...realVenueKeys.map((key) => computeActualCogs({ venue: key, start, end }))
    ]);
    const cogsByVenue = new Map<string, ActualCogs>();
    let realCogsSum = 0;
    let realPurchasesSum = 0;
    realVenueKeys.forEach((key, index) => {
      const cogs = realVenueCogs[index];
      if (!cogs) return;
      cogsByVenue.set(key, cogs);
      realCogsSum += cogs.cogsCents;
      realPurchasesSum += cogs.purchasesCents;
    });
    if (rows.has('Unassigned')) {
      cogsByVenue.set('Unassigned', {
        cogsCents: Math.max(0, allVenuesCogs.cogsCents - realCogsSum),
        purchasesCents: Math.max(0, allVenuesCogs.purchasesCents - realPurchasesSum),
        openingStockCents: 0,
        closingStockCents: 0,
        openingStockAvailable: false,
        closingStockAvailable: false,
        source: 'purchases_only',
        quality: 'estimated'
      });
    }
    const cogsFor = (key: string): ActualCogs =>
      cogsByVenue.get(key) ?? {
        cogsCents: 0, purchasesCents: 0, openingStockCents: 0, closingStockCents: 0,
        openingStockAvailable: false, closingStockAvailable: false, source: 'purchases_only', quality: 'estimated'
      };

    const venues = Array.from(rows.values()).map((row) => {
      const wageCents = row.wageCents || row.rosterWageEstimateCents;
      const cogs = cogsFor(row.venue);
      const cogsCents = cogs.cogsCents;
      const primeCostCents = wageCents + cogsCents;
      return {
        venue: row.venue,
        salesCents: row.salesCents,
        wageCents,
        approvedWageCents: row.approvedWageCents,
        rosterWageEstimateCents: row.rosterWageEstimateCents,
        cogsCents,
        invoiceCogsCents: row.invoiceCogsCents,
        wastageCents: row.wastageCents,
        purchasesCents: cogs.purchasesCents,
        openingStockCents: cogs.openingStockCents,
        closingStockCents: cogs.closingStockCents,
        cogsSource: cogs.source,
        cogsQuality: cogs.quality,
        primeCostCents,
        wagePercent: pct(wageCents, row.salesCents),
        cogsPercent: pct(cogsCents, row.salesCents),
        primeCostPercent: pct(primeCostCents, row.salesCents),
        timesheetHours: Math.round(row.timesheetHours * 100) / 100,
        rosterHours: Math.round(row.rosterHours * 100) / 100,
        salesDays: row.salesDays.size,
        ...primeQuality({ sales: row.salesCents, wages: row.wageCents, cogs: cogsCents, rosterEstimate: row.rosterWageEstimateCents })
      };
    }).sort((a, b) => a.venue.localeCompare(b.venue));

    const totalBase = venues.reduce((total, row) => ({
      salesCents: total.salesCents + row.salesCents,
      wageCents: total.wageCents + row.wageCents,
      approvedWageCents: total.approvedWageCents + row.approvedWageCents,
      rosterWageEstimateCents: total.rosterWageEstimateCents + row.rosterWageEstimateCents,
      cogsCents: total.cogsCents + row.cogsCents,
      invoiceCogsCents: total.invoiceCogsCents + row.invoiceCogsCents,
      wastageCents: total.wastageCents + row.wastageCents,
      purchasesCents: total.purchasesCents + row.purchasesCents,
      openingStockCents: total.openingStockCents + row.openingStockCents,
      closingStockCents: total.closingStockCents + row.closingStockCents,
      primeCostCents: total.primeCostCents + row.primeCostCents,
      timesheetHours: total.timesheetHours + row.timesheetHours,
      rosterHours: total.rosterHours + row.rosterHours,
      salesDays: Math.max(total.salesDays, row.salesDays)
    }), {
      salesCents: 0,
      wageCents: 0,
      approvedWageCents: 0,
      rosterWageEstimateCents: 0,
      cogsCents: 0,
      invoiceCogsCents: 0,
      wastageCents: 0,
      purchasesCents: 0,
      openingStockCents: 0,
      closingStockCents: 0,
      primeCostCents: 0,
      timesheetHours: 0,
      rosterHours: 0,
      salesDays: 0
    });
    const totalQuality = primeQuality({
      sales: totalBase.salesCents,
      wages: totalBase.wageCents,
      cogs: totalBase.cogsCents,
      rosterEstimate: totalBase.rosterWageEstimateCents
    });

    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      totals: {
        ...totalBase,
        cogsSource: allVenuesCogs.source,
        cogsQuality: allVenuesCogs.quality,
        wagePercent: pct(totalBase.wageCents, totalBase.salesCents),
        cogsPercent: pct(totalBase.cogsCents, totalBase.salesCents),
        primeCostPercent: pct(totalBase.primeCostCents, totalBase.salesCents),
        timesheetHours: Math.round(totalBase.timesheetHours * 100) / 100,
        rosterHours: Math.round(totalBase.rosterHours * 100) / 100,
        ...totalQuality
      },
      venues,
      sources: {
        sales: salesEntries.length ? 'actual_sales_import' : 'missing',
        wages: timesheets.length ? 'timesheet_actuals' : rosterShifts.length ? 'roster_estimate' : 'missing',
        // COGS now uses the suite-wide canonical figure, not invoice lines.
        cogs: totalBase.salesCents === 0 && allVenuesCogs.cogsCents === 0 ? 'missing' : allVenuesCogs.source
      },
      warnings: [
        allVenuesCogs.source === 'stock_bounded'
          ? 'COGS is the canonical figure: opening stock + ex-GST purchases − closing stock for the period.'
          : 'COGS is estimated from ex-GST purchases only — lock an opening and closing stocktake at the period boundaries for a true opening + purchases − closing figure.',
        ...(timesheets.length ? ['Wages use current timesheet hours and staff pay rates. Approved wages are shown separately.'] : ['No timesheets found; roster wage estimate is used only when roster shifts exist.']),
        ...(salesEntries.length ? [] : ['Sales are missing for the selected period, so wage %, COGS %, and prime cost % are not shown.'])
      ]
    };
  },

  async menuProfitability(input: unknown, actor?: AuthUser): Promise<ReportsMenuProfitabilityPayload> {
    const data = reportsMenuProfitabilityQuerySchema.parse(input);
    const start = parseDate(data.start, 'Menu profitability start date');
    const end = parseDate(data.end, 'Menu profitability end date');
    if (end <= start) throw new HttpError(400, 'Menu profitability end date must be after the start date');
    const venue = salesVenueScope(actor, data.venue);
    const accountKeys = data.accountKey === 'all' ? ['primary', 'secondary'] as const : [data.accountKey];
    const sourceWhere = data.accountKey === 'all'
      ? { startsWith: 'square-item:' }
      : `square-item:${data.accountKey}`;

    const [entries, mappings] = await Promise.all([
      prisma.salesItemActualEntry.findMany({
        where: {
          serviceDate: { gte: start, lt: end },
          source: typeof sourceWhere === 'string' ? sourceWhere : sourceWhere,
          ...(venue ? { venue } : {}),
          ...(data.category ? { categoryName: data.category } : {})
        },
        include: {
          recipe: { select: { id: true, title: true, estimatedCost: true } }
        },
        orderBy: [{ netSalesCents: 'desc' }, { itemName: 'asc' }]
      }),
      prisma.squareMenuRecipeMapping.findMany({
        where: {
          accountKey: { in: [...accountKeys] },
          ...(data.category ? { categoryName: data.category } : {})
        },
        include: {
          almaRecipe: { select: { id: true, title: true, estimatedCost: true } }
        }
      })
    ]);

    const mappingByCatalogObject = new Map<string, typeof mappings[number]>();
    const mappingByName = new Map<string, typeof mappings[number]>();
    for (const mapping of mappings) {
      if (mapping.squareVariationId) mappingByCatalogObject.set(`${mapping.accountKey}:${mapping.squareVariationId}`, mapping);
      if (mapping.squareItemId) mappingByCatalogObject.set(`${mapping.accountKey}:${mapping.squareItemId}`, mapping);
      mappingByName.set(
        `${mapping.accountKey}:${normaliseMenuText(mapping.squareItemName)}:${normaliseMenuText(mapping.squareVariationName)}`,
        mapping
      );
    }

    const rowsByKey = new Map<string, ReportsMenuProfitabilityRow>();
    const categories = new Set<string>();
    const venues = new Set<string>();

    for (const entry of entries) {
      const accountKey = accountKeyFromSalesSource(entry.source);
      const mapping = accountKey === 'unknown'
        ? null
        : (entry.catalogObjectId ? mappingByCatalogObject.get(`${accountKey}:${entry.catalogObjectId}`) : null)
          ?? mappingByName.get(`${accountKey}:${normaliseMenuText(entry.itemName)}:${normaliseMenuText(entry.variationName)}`)
          ?? null;
      const mappedRecipe = mapping?.status === 'MAPPED' ? mapping.almaRecipe : null;
      const unitRecipeCostCents = recipeCostCents(mappedRecipe);
      const mappingStatus: ReportsMenuProfitabilityRow['mappingStatus'] = !mapping || mapping.status !== 'MAPPED'
        ? 'unmapped'
        : !mappedRecipe
          ? 'missing_recipe'
          : unitRecipeCostCents === null
            ? 'missing_cost'
            : 'mapped';
      const key = [
        accountKey,
        entry.venue,
        entry.catalogObjectId ?? normaliseMenuText(entry.itemName),
        normaliseMenuText(entry.variationName)
      ].join('|');
      const current = rowsByKey.get(key) ?? {
        key,
        accountKey,
        venue: entry.venue,
        squareItem: entry.itemName,
        variationName: entry.variationName,
        categoryName: entry.categoryName,
        catalogObjectId: entry.catalogObjectId,
        quantitySold: 0,
        grossSalesCents: 0,
        netSalesCents: 0,
        orderCount: 0,
        lineCount: 0,
        mappingStatus,
        mappingId: mapping?.id ?? null,
        almaRecipeId: mappedRecipe?.id ?? null,
        almaRecipeTitle: mappedRecipe?.title ?? null,
        recipeCostCents: unitRecipeCostCents,
        estimatedCogsCents: null,
        grossProfitCents: null,
        foodCostPercent: null,
        dataQuality: []
      };

      current.quantitySold += entry.quantity;
      current.grossSalesCents += entry.grossSalesCents;
      current.netSalesCents += entry.netSalesCents;
      current.orderCount += entry.orderCount;
      current.lineCount += entry.lineCount;
      if (entry.categoryName) categories.add(entry.categoryName);
      venues.add(entry.venue);
      rowsByKey.set(key, current);
    }

    let rows = Array.from(rowsByKey.values()).map((row) => {
      const estimatedCogsCents = row.recipeCostCents !== null
        ? Math.round(row.recipeCostCents * row.quantitySold)
        : null;
      const grossProfitCents = estimatedCogsCents !== null ? row.netSalesCents - estimatedCogsCents : null;
      const foodCostPercent = estimatedCogsCents !== null ? pct(estimatedCogsCents, row.netSalesCents) : null;
      const dataQuality: ReportsMenuProfitabilityRow['dataQuality'] = ['actual_sales'];
      if (row.mappingStatus === 'mapped') dataQuality.push('mapped_recipe_cost');
      if (row.mappingStatus === 'unmapped') dataQuality.push('unmapped_square_item');
      if (row.mappingStatus === 'missing_recipe') dataQuality.push('missing_recipe');
      if (row.mappingStatus === 'missing_cost') dataQuality.push('missing_cost');
      return { ...row, estimatedCogsCents, grossProfitCents, foodCostPercent, dataQuality };
    });

    if (data.mappingStatus !== 'all') {
      rows = rows.filter((row) => row.mappingStatus === data.mappingStatus);
    }
    rows.sort((a, b) => b.netSalesCents - a.netSalesCents);

    const rowsWithCost = rows.filter((row) => row.estimatedCogsCents !== null);
    const estimatedCogsCents = rowsWithCost.length
      ? rowsWithCost.reduce((sum, row) => sum + (row.estimatedCogsCents ?? 0), 0)
      : null;
    const netSalesCents = rows.reduce((sum, row) => sum + row.netSalesCents, 0);
    const grossProfitCents = estimatedCogsCents !== null ? netSalesCents - estimatedCogsCents : null;

    return {
      generatedAt: new Date().toISOString(),
      period: { start: start.toISOString(), end: end.toISOString() },
      filters: data,
      totals: {
        itemRows: rows.length,
        quantitySold: Math.round(rows.reduce((sum, row) => sum + row.quantitySold, 0) * 100) / 100,
        netSalesCents,
        estimatedCogsCents,
        grossProfitCents,
        foodCostPercent: estimatedCogsCents !== null ? pct(estimatedCogsCents, netSalesCents) : null,
        mappedRows: rows.filter((row) => row.mappingStatus === 'mapped').length,
        unmappedRows: rows.filter((row) => row.mappingStatus === 'unmapped').length,
        missingRecipeRows: rows.filter((row) => row.mappingStatus === 'missing_recipe').length,
        missingCostRows: rows.filter((row) => row.mappingStatus === 'missing_cost').length
      },
      categories: Array.from(categories).sort(),
      venues: Array.from(venues).sort(),
      rows,
      warnings: [
        ...(entries.length ? [] : ['No Square item-level sales were found for the selected period. Import Square item sales before using menu profitability.']),
        ...(rows.some((row) => row.mappingStatus === 'unmapped') ? ['Some Square items are not mapped to Alma recipes, so COGS and margin are incomplete.'] : []),
        ...(rows.some((row) => row.mappingStatus === 'missing_cost') ? ['Some mapped recipes have no cost yet. Update recipe ingredients/costs in Stock.'] : [])
      ]
    };
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

  async listItemActualSales(input: unknown, actor?: AuthUser): Promise<SalesItemActualSummary> {
    const data = salesActualQuerySchema.parse(input);
    const start = parseDate(data.start, 'Item sales start date');
    const end = parseDate(data.end, 'Item sales end date');
    if (end <= start) throw new HttpError(400, 'Item sales end date must be after the start date');
    const venue = salesVenueScope(actor, data.venue);

    const entries = await prisma.salesItemActualEntry.findMany({
      where: {
        serviceDate: { gte: start, lt: end },
        ...(venue ? { venue } : {})
      },
      orderBy: [{ serviceDate: 'asc' }, { venue: 'asc' }, { netSalesCents: 'desc' }]
    });

    const byVenue = Array.from(
      entries.reduce((map, entry) => {
        const current = map.get(entry.venue) ?? { venue: entry.venue, netSalesCents: 0, quantity: 0, rows: 0 };
        current.netSalesCents += entry.netSalesCents;
        current.quantity += entry.quantity;
        current.rows += 1;
        map.set(entry.venue, current);
        return map;
      }, new Map<string, { venue: string; netSalesCents: number; quantity: number; rows: number }>())
        .values()
    );

    return {
      entries: entries.map((entry) => ({
        id: entry.id,
        venue: entry.venue,
        serviceDate: entry.serviceDate.toISOString(),
        source: entry.source,
        externalId: entry.externalId,
        itemName: entry.itemName,
        variationName: entry.variationName,
        categoryName: entry.categoryName,
        sku: entry.sku,
        catalogObjectId: entry.catalogObjectId,
        locationName: entry.locationName,
        quantity: entry.quantity,
        grossSalesCents: entry.grossSalesCents,
        netSalesCents: entry.netSalesCents,
        orderCount: entry.orderCount,
        lineCount: entry.lineCount,
        recipeId: entry.recipeId,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString()
      })),
      totalNetSalesCents: entries.reduce((sum, entry) => sum + entry.netSalesCents, 0),
      totalQuantity: entries.reduce((sum, entry) => sum + entry.quantity, 0),
      matchedRecipeRows: entries.filter((entry) => entry.recipeId).length,
      unmatchedRows: entries.filter((entry) => !entry.recipeId).length,
      byVenue
    };
  },

  // Set-menu margin roll-up. The priced "parent" line (Trust Our Chef, Grazing
  // Menu, Bottomless Lunch …) carries the revenue; the $0 component lines carry
  // the COGS. Components split cleanly by venue + marker: a trailing "*" is a
  // tasting/grazing course, a "BB " prefix is a bottomless component. Each
  // component costs one portion of its mapped recipe (batch cost / portions),
  // so a partly-mapped menu still rolls up — and the gaps are surfaced.
  async menuCostOfGoods(input: unknown, actor?: AuthUser) {
    const data = salesActualQuerySchema.parse(input);
    const start = parseDate(data.start, 'Menu COGS start date');
    const end = parseDate(data.end, 'Menu COGS end date');
    if (end <= start) throw new HttpError(400, 'Menu COGS end date must be after the start date');
    const venueScope = salesVenueScope(actor, data.venue);

    const [entries, recipes] = await Promise.all([
      prisma.salesItemActualEntry.findMany({
        where: {
          serviceDate: { gte: start, lt: end },
          source: { startsWith: 'square-item:' },
          ...(venueScope ? { venue: venueScope } : {})
        },
        select: { venue: true, itemName: true, quantity: true, netSalesCents: true, recipeId: true }
      }),
      prisma.recipe.findMany({
        select: { id: true, estimatedCost: true, yieldQuantity: true, portionSize: true }
      })
    ]);

    // Per-portion cost (cents): a component is one portion of its recipe, not
    // the whole batch, so divide the batch cost by the portion count.
    const costPerPortionCents = new Map<string, number>();
    for (const recipe of recipes) {
      if (recipe.estimatedCost == null || recipe.estimatedCost <= 0) continue;
      const portions =
        recipe.portionSize && recipe.portionSize > 0 && recipe.yieldQuantity && recipe.yieldQuantity > 0
          ? recipe.yieldQuantity / recipe.portionSize
          : recipe.yieldQuantity && recipe.yieldQuantity > 0
            ? recipe.yieldQuantity
            : 1;
      costPerPortionCents.set(recipe.id, Math.round((recipe.estimatedCost * 100) / portions));
    }

    type MenuGroup = { key: string; label: string; venue: string; parent: RegExp; component: 'star' | 'bb' };
    const GROUPS: MenuGroup[] = [
      { key: 'tasting', label: 'Trust Our Chef · tasting', venue: 'St Alma', parent: /trust our chef/i, component: 'star' },
      { key: 'grazing', label: 'Grazing Menu', venue: 'Alma Avalon', parent: /grazing menu/i, component: 'star' },
      { key: 'bottomless-sta', label: 'Bottomless Lunch · St Alma', venue: 'St Alma', parent: /bottomless lunch (food|drinks)/i, component: 'bb' },
      { key: 'bottomless-ava', label: 'Bottomless Lunch · Alma Avalon', venue: 'Alma Avalon', parent: /bottomless lunch (food|drinks)/i, component: 'bb' }
    ];
    const isStar = (name: string) => /\*\s*$/.test(name);
    const isBb = (name: string) => /^bb\b/i.test(name);
    const isWorkflowMarker = (name: string) => /already sent|^fire\b|^send\b|^course\b/i.test(name);

    const acc = new Map<
      string,
      {
        group: MenuGroup;
        revenueCents: number;
        covers: number;
        cogsCents: number;
        componentUnits: number;
        costedUnits: number;
        missingUnits: number;
        missing: Map<string, number>;
      }
    >();
    for (const group of GROUPS) {
      acc.set(group.key, {
        group,
        revenueCents: 0,
        covers: 0,
        cogsCents: 0,
        componentUnits: 0,
        costedUnits: 0,
        missingUnits: 0,
        missing: new Map<string, number>()
      });
    }

    for (const entry of entries) {
      const name = (entry.itemName ?? '').trim();
      if (!name) continue;
      const componentType: 'star' | 'bb' | null = isStar(name) ? 'star' : isBb(name) ? 'bb' : null;

      if (componentType && !isWorkflowMarker(name)) {
        const group = GROUPS.find((g) => g.venue === entry.venue && g.component === componentType);
        if (!group) continue;
        const bucket = acc.get(group.key)!;
        bucket.componentUnits += entry.quantity;
        const unitCost = entry.recipeId ? costPerPortionCents.get(entry.recipeId) ?? null : null;
        if (unitCost != null) {
          bucket.cogsCents += unitCost * entry.quantity;
          bucket.costedUnits += entry.quantity;
        } else {
          bucket.missingUnits += entry.quantity;
          bucket.missing.set(name, (bucket.missing.get(name) ?? 0) + entry.quantity);
        }
        continue;
      }

      if (entry.netSalesCents > 0) {
        const group = GROUPS.find((g) => g.venue === entry.venue && g.parent.test(name));
        if (!group) continue;
        const bucket = acc.get(group.key)!;
        bucket.revenueCents += entry.netSalesCents;
        bucket.covers += entry.quantity;
      }
    }

    const groups = [...acc.values()].map((b) => ({
      key: b.group.key,
      label: b.group.label,
      venue: b.group.venue,
      revenueCents: b.revenueCents,
      covers: b.covers,
      cogsCents: b.cogsCents,
      grossMarginCents: b.revenueCents - b.cogsCents,
      foodCostPct: b.revenueCents > 0 ? Math.round((b.cogsCents / b.revenueCents) * 1000) / 10 : null,
      componentUnits: b.componentUnits,
      costedUnits: b.costedUnits,
      missingUnits: b.missingUnits,
      coveragePct: b.componentUnits > 0 ? Math.round((b.costedUnits / b.componentUnits) * 100) : 0,
      perCoverRevenueCents: b.covers > 0 ? Math.round(b.revenueCents / b.covers) : null,
      perCoverCogsCents: b.covers > 0 ? Math.round(b.cogsCents / b.covers) : null,
      topMissing: [...b.missing.entries()]
        .sort((a, c) => c[1] - a[1])
        .slice(0, 8)
        .map(([itemName, units]) => ({ itemName, units }))
    }));

    // Consolidated, ranked costing worklist across all menus — what to cost
    // next to sharpen the COGS, biggest sales impact first. type: star =
    // tasting/grazing course, bb = bottomless component.
    const missingComponents: Array<{ itemName: string; venue: string; menu: string; units: number; type: 'star' | 'bb' }> = [];
    for (const b of acc.values()) {
      for (const [itemName, units] of b.missing) {
        missingComponents.push({ itemName, venue: b.group.venue, menu: b.group.label, units, type: b.group.component });
      }
    }
    missingComponents.sort((a, c) => c.units - a.units);

    const totalRevenue = groups.reduce((s, g) => s + g.revenueCents, 0);
    const totalCogs = groups.reduce((s, g) => s + g.cogsCents, 0);

    return {
      generatedAt: new Date().toISOString(),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      venue: venueScope,
      groups,
      missingComponents: missingComponents.slice(0, 60),
      missingComponentCount: missingComponents.length,
      missingComponentUnits: missingComponents.reduce((s, m) => s + m.units, 0),
      totals: {
        revenueCents: totalRevenue,
        cogsCents: totalCogs,
        grossMarginCents: totalRevenue - totalCogs,
        foodCostPct: totalRevenue > 0 ? Math.round((totalCogs / totalRevenue) * 1000) / 10 : null
      }
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
  },

  // Stocktake status overview (Sprint 2.4) — for each venue, return the
  // latest LOCKED stocktake (the one Reports trust for stock value /
  // COGS) plus a freshness signal. Used by the Reports Overview widget.
  async monthlyRecap(input: unknown, actor: AuthUser): Promise<MonthlyRecapPayload> {
    const query = reportsMonthlyRecapQuerySchema.parse(input ?? {});
    const venue = actorVenueScope(actor, query.venue);
    const today = new Date();
    const month = query.month ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const yy = Number(month.slice(0, 4));
    const mm = Number(month.slice(5, 7));
    const monthStart = new Date(yy, mm - 1, 1);
    const monthEnd = new Date(yy, mm, 1);
    const priorMonthStart = new Date(yy - 1, mm - 1, 1);
    const priorMonthEnd = new Date(yy - 1, mm, 1);
    const fyStart = financialYearStart(monthStart);
    const priorFyStart = new Date(fyStart.getFullYear() - 1, 6, 1);
    const priorFyYtdEnd = new Date(monthEnd.getFullYear() - 1, monthEnd.getMonth(), 1);

    const [monthCurrent, monthPriorYear, ytdCurrent, ytdPriorYear] = await Promise.all([
      recapPeriod(venue, monthStart, monthEnd, recapMonthLabel(month)),
      recapPeriod(venue, priorMonthStart, priorMonthEnd, recapMonthLabel(`${yy - 1}-${String(mm).padStart(2, '0')}`)),
      recapPeriod(venue, fyStart, monthEnd, 'FY to date'),
      recapPeriod(venue, priorFyStart, priorFyYtdEnd, 'Prior FY to date')
    ]);
    const targets = { wagePct: 30, cogsPct: 30, primePct: 60 };
    return {
      generatedAt: new Date().toISOString(),
      venue: venue ?? null,
      month,
      monthLabel: recapMonthLabel(month),
      ytdBasis: 'FY',
      ytdLabel: `FY ${fyStart.getFullYear()}/${String(fyStart.getFullYear() + 1).slice(2)} to ${recapMonthLabel(month)}`,
      targets,
      monthCurrent,
      monthPriorYear,
      ytdCurrent,
      ytdPriorYear,
      recommendations: recapRecommendations(monthCurrent, monthPriorYear, targets)
    };
  },

  async emailMonthlyRecap(input: unknown, actor: AuthUser) {
    const data = reportsMonthlyRecapEmailInputSchema.parse(input ?? {});
    if (!mailService.isConfigured()) throw new HttpError(503, 'Email delivery is not configured.');
    const recap = await reportsService.monthlyRecap({ month: data.month, venue: data.venue }, actor);
    const subject = `Monthly Recap — ${recap.monthLabel}${recap.venue ? ` · ${recap.venue}` : ''}`;
    const result = await mailService.sendDocument({
      to: data.to,
      subject,
      text: renderMonthlyRecapText(recap),
      html: renderMonthlyRecapHtml(recap)
    });
    return { status: result.status, to: data.to, month: recap.month };
  },

  // Pull the data behind the recap straight from source: Xero supplier bills
  // (purchases → COGS) and Deputy timesheets (→ wages). Looks back far enough
  // to cover the start of the month being viewed. Sales come from Square, not
  // these two, so they're left untouched.
  async syncMonthlyRecapSources(input: unknown, actor: AuthUser) {
    const query = reportsMonthlyRecapQuerySchema.parse(input ?? {});
    const today = new Date();
    const month = query.month ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const yy = Number(month.slice(0, 4));
    const mm = Number(month.slice(5, 7));
    const monthStart = new Date(yy, mm - 1, 1);
    const lookbackDays = Math.min(180, Math.max(7, Math.ceil((today.getTime() - monthStart.getTime()) / 86_400_000) + 2));
    const errors: string[] = [];
    let xero = false;
    let deputy = false;
    try {
      await integrationService.runScheduledXeroImport({ lookbackDays });
      xero = true;
    } catch (error) {
      errors.push(`Xero: ${error instanceof Error ? error.message : 'sync failed'}`);
    }
    try {
      await deputyService.syncTimesheetsNow(actor);
      deputy = true;
    } catch (error) {
      errors.push(`Deputy: ${error instanceof Error ? error.message : 'sync failed'}`);
    }
    return { month, lookbackDays, xero, deputy, errors, ranAt: new Date().toISOString() };
  },

  // Cron entrypoint: email the just-finished month's recap (all venues) to the
  // configured recipients. Recipients come from MONTHLY_RECAP_RECIPIENTS
  // (comma/space/semicolon-separated). Designed to be hit by Cloud Scheduler on
  // the 1st of each month; supports { previewOnly:true } for safe dry runs.
  async sendScheduledMonthlyRecap(options: { previewOnly?: boolean; month?: string; recipients?: string[] } = {}) {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = options.month ?? `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const recipients = (options.recipients?.length
      ? options.recipients
      : (process.env.MONTHLY_RECAP_RECIPIENTS ?? '')
          .split(/[,;\s]+/)
          .map((value) => value.trim())
          .filter((value) => value.includes('@')));
    if (recipients.length === 0) {
      return {
        sent: false as const,
        reason: 'no_recipients',
        month,
        note: 'Set MONTHLY_RECAP_RECIPIENTS (comma-separated) to enable the monthly auto-send.'
      };
    }
    if (!mailService.isConfigured()) {
      return { sent: false as const, reason: 'mail_not_configured', month };
    }
    // System actor so the recap spans all venues (admin scope).
    const systemActor = {
      id: null,
      firstName: 'Alma',
      lastName: 'Scheduler',
      email: null,
      venue: null,
      isAdmin: true,
      role: 'ADMIN'
    } as unknown as AuthUser;
    const recap = await reportsService.monthlyRecap({ month }, systemActor);
    const subject = `Monthly Recap — ${recap.monthLabel}`;
    if (options.previewOnly) {
      return { sent: false as const, previewOnly: true, month, recipients, subject };
    }
    const results = await Promise.all(
      recipients.map(async (to) => {
        try {
          const result = await mailService.sendDocument({
            to,
            subject,
            text: renderMonthlyRecapText(recap),
            html: renderMonthlyRecapHtml(recap)
          });
          return { to, status: result.status };
        } catch (error) {
          return { to, status: 'error', error: error instanceof Error ? error.message : 'failed' };
        }
      })
    );
    return { sent: true as const, month, subject, recipients: recipients.length, results, ranAt: new Date().toISOString() };
  },

  async stocktakeStatus(actor: AuthUser) {
    const venue = actorVenueScope(actor);
    const venues = venue
      ? [venue]
      : Array.from(new Set((await prisma.stocktake.findMany({ where: { venue: { not: null } }, select: { venue: true }, distinct: ['venue'] })).map((s) => s.venue!).filter(Boolean)));

    const STALE_DAYS = 14;
    const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

    const venueStatuses = await Promise.all(venues.map(async (v) => {
      const latestLocked = await prisma.stocktake.findFirst({
        where: { venue: v, status: 'LOCKED' },
        orderBy: [{ countedAt: 'desc' }],
        include: {
          _count: { select: { lines: true } },
          lines: { select: { stockValueCents: true } }
        }
      });
      const latestAny = await prisma.stocktake.findFirst({
        where: { venue: v },
        orderBy: [{ countedAt: 'desc' }],
        select: { id: true, status: true, countedAt: true, name: true }
      });
      const stockValueCents = latestLocked?.lines.reduce((sum, line) => sum + (line.stockValueCents ?? 0), 0) ?? null;
      const stale = latestLocked ? latestLocked.countedAt < staleCutoff : true;

      return {
        venue: v,
        latestLocked: latestLocked ? {
          id: latestLocked.id,
          name: latestLocked.name,
          countedAt: latestLocked.countedAt.toISOString(),
          lockedAt: latestLocked.lockedAt?.toISOString() ?? null,
          lineCount: latestLocked._count.lines,
          stockValueCents,
          stale
        } : null,
        latestAny: latestAny ? {
          id: latestAny.id,
          name: latestAny.name,
          status: latestAny.status,
          countedAt: latestAny.countedAt.toISOString()
        } : null,
        // Quality grade — green if locked AND fresh, amber if locked but
        // stale OR submitted/reviewed but not locked, red if no stocktake
        // at all OR only IN_PROGRESS drafts.
        quality: latestLocked
          ? (stale ? 'partial' : 'good')
          : (latestAny && (latestAny.status === 'SUBMITTED' || latestAny.status === 'REVIEWED') ? 'partial' : 'poor')
      };
    }));

    return {
      generatedAt: new Date().toISOString(),
      staleDays: STALE_DAYS,
      venues: venueStatuses
    };
  }
};
