import { prisma } from '@alma/db';
import { z } from 'zod';
import {
  salesActualImportSchema,
  salesActualQuerySchema
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

function parseDate(value: string, label: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${label} is invalid`);
  }
  return date;
}

export const reportsService = {
  async listActualSales(input: unknown) {
    const data = salesActualQuerySchema.parse(input);
    const start = parseDate(data.start, 'Sales start date');
    const end = parseDate(data.end, 'Sales end date');
    if (end <= start) throw new HttpError(400, 'Sales end date must be after the start date');

    const entries = await prisma.salesActualEntry.findMany({
      where: {
        serviceDate: { gte: start, lt: end },
        ...(data.venue ? { venue: data.venue } : {})
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

  async importActualSales(input: unknown, importedById?: string) {
    const data = salesActualImportSchema.parse(input);
    let imported = 0;

    for (const row of data.rows) {
      const serviceDate = parseDate(row.serviceDate, 'Sales service date');
      const externalId = row.externalId?.trim() || `${row.venue}:${serviceDate.toISOString().slice(0, 10)}:${data.source}`;
      await prisma.salesActualEntry.upsert({
        where: {
          venue_serviceDate_source_externalId: {
            venue: row.venue.trim(),
            serviceDate,
            source: data.source.trim(),
            externalId
          }
        },
        create: {
          venue: row.venue.trim(),
          serviceDate,
          salesCents: row.salesCents,
          source: data.source.trim(),
          externalId,
          notes: row.notes?.trim() || null,
          importedById: importedById || null
        },
        update: {
          salesCents: row.salesCents,
          notes: row.notes?.trim() || null,
          importedById: importedById || null
        }
      });
      imported += 1;
    }

    return { imported };
  },

  async deleteActualSalesEntry(id: string) {
    const existing = await prisma.salesActualEntry.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Sales entry not found');
    await prisma.salesActualEntry.delete({ where: { id } });
    return { ok: true };
  },

  async clearActualSales(input: unknown) {
    const data = salesActualQuerySchema.extend({
      source: z.string().optional().or(z.literal(''))
    }).parse(input);
    const start = parseDate(data.start, 'Sales start date');
    const end = parseDate(data.end, 'Sales end date');
    if (end <= start) throw new HttpError(400, 'Sales end date must be after the start date');

    const deleted = await prisma.salesActualEntry.deleteMany({
      where: {
        serviceDate: { gte: start, lt: end },
        ...(data.venue ? { venue: data.venue } : {}),
        ...(data.source ? { source: data.source } : {})
      }
    });

    return { deleted: deleted.count };
  }
};
