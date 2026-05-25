import { Router } from 'express';
import { prisma } from '@alma/db';

export const publicSnapshotRouter = Router();

// GET /api/public/venue-snapshot?venue=X
// Returns a read-only operational snapshot for the venue iPad dashboard.
// Lives under PUBLIC_PATHS so the iPad doesn't need a login — it's a
// shared trusted device showing always-on counters. No personal data.
publicSnapshotRouter.get('/venue-snapshot', async (req, res, next) => {
  try {
    const venueRaw = typeof req.query.venue === 'string' ? req.query.venue.trim() : '';
    const venue = venueRaw || null;
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const [bookingsToday, coversToday, openIssues, criticalIssues, recentTempLogs, activeChecklistRuns] = await Promise.all([
      // Reservations for today (active statuses only)
      prisma.reserveReservation.count({
        where: {
          startsAt: { gte: startOfDay, lt: endOfDay },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          ...(venue ? { venue } : {})
        }
      }),
      // Total covers across today's reservations
      prisma.reserveReservation.aggregate({
        _sum: { covers: true },
        where: {
          startsAt: { gte: startOfDay, lt: endOfDay },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          ...(venue ? { venue } : {})
        }
      }),
      // Open compliance issues (Issue has no venue field — venue filter
      // limited to reservations + temp where those have venue scope)
      prisma.issue.count({
        where: {
          status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] }
        }
      }),
      // Critical (overdue or HIGH/CRITICAL severity) compliance issues
      prisma.issue.count({
        where: {
          status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] },
          OR: [
            { dueDate: { lt: now } },
            { severity: { in: ['HIGH', 'CRITICAL'] } }
          ]
        }
      }),
      // Temperature logs in the last hour, to surface ongoing out-of-range
      prisma.temperatureLog.findMany({
        where: {
          recordedAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) },
          status: 'OUT_OF_RANGE',
          ...(venue ? { asset: { venue } } : {})
        },
        select: { assetId: true },
        distinct: ['assetId']
      }),
      // Checklist runs that started today and aren't complete
      prisma.checklistRun.count({
        where: {
          createdAt: { gte: startOfDay, lt: endOfDay },
          status: { in: ['OPEN', 'IN_PROGRESS'] }
        }
      })
    ]);

    res.json({
      venue,
      generatedAt: now.toISOString(),
      bookings: {
        today: bookingsToday,
        coversToday: coversToday._sum.covers ?? 0
      },
      checklists: {
        active: activeChecklistRuns
      },
      temperatures: {
        outOfRangeSensors: recentTempLogs.length
      },
      compliance: {
        openIssues,
        criticalIssues
      }
    });
  } catch (error) {
    next(error);
  }
});
