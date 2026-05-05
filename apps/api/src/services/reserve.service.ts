import { prisma } from '@alma/db';
import {
  reserveGuestInputSchema,
  reserveReservationInputSchema,
  reserveReservationUpdateInputSchema,
  reserveTableInputSchema
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

function parseDate(value: string, label: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${label} is invalid`);
  return date;
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toGuestPayload(guest: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  allergyNotes: string | null;
  visitNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...guest,
    createdAt: guest.createdAt.toISOString(),
    updatedAt: guest.updatedAt.toISOString()
  };
}

function toTablePayload(table: {
  id: string;
  venue: string;
  area: string;
  label: string;
  minCovers: number;
  maxCovers: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...table,
    createdAt: table.createdAt.toISOString(),
    updatedAt: table.updatedAt.toISOString()
  };
}

function toReservationPayload(reservation: {
  id: string;
  venue: string;
  serviceDate: Date;
  servicePeriod: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'EVENT';
  startsAt: Date;
  endsAt: Date;
  covers: number;
  status: 'PENDING' | 'CONFIRMED' | 'SEATED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  source: string;
  tableId: string | null;
  guestId: string;
  occasion: string | null;
  notes: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  guest: Parameters<typeof toGuestPayload>[0];
  table: Parameters<typeof toTablePayload>[0] | null;
}) {
  return {
    ...reservation,
    serviceDate: reservation.serviceDate.toISOString(),
    startsAt: reservation.startsAt.toISOString(),
    endsAt: reservation.endsAt.toISOString(),
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
    guest: toGuestPayload(reservation.guest),
    table: reservation.table ? toTablePayload(reservation.table) : null
  };
}

async function findOrCreateGuest(input: unknown) {
  const data = reserveGuestInputSchema.parse(input);
  const email = data.email?.trim() || null;
  const phone = data.phone?.trim() || null;
  const existing = email || phone
    ? await prisma.reserveGuest.findFirst({
      where: {
        OR: [
          ...(email ? [{ email }] : []),
          ...(phone ? [{ phone }] : [])
        ]
      }
    })
    : null;

  const payload = {
    firstName: data.firstName.trim(),
    lastName: data.lastName.trim(),
    email,
    phone,
    tags: data.tags.map((tag) => tag.trim()).filter(Boolean),
    allergyNotes: data.allergyNotes?.trim() || null,
    visitNotes: data.visitNotes?.trim() || null
  };

  if (existing) {
    return prisma.reserveGuest.update({
      where: { id: existing.id },
      data: payload
    });
  }

  return prisma.reserveGuest.create({ data: payload });
}

export const reserveService = {
  async diary(input: { start?: string; end?: string; venue?: string }) {
    const start = input.start ? parseDate(input.start, 'Diary start date') : startOfDay(new Date());
    const end = input.end ? parseDate(input.end, 'Diary end date') : new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (end <= start) throw new HttpError(400, 'Diary end date must be after start date');
    const venue = input.venue?.trim() || 'All venues';

    const [reservations, tables] = await Promise.all([
      prisma.reserveReservation.findMany({
        where: {
          startsAt: { gte: start, lt: end },
          ...(input.venue ? { venue: input.venue } : {})
        },
        orderBy: [{ startsAt: 'asc' }, { venue: 'asc' }],
        include: { guest: true, table: true }
      }),
      prisma.reserveTable.findMany({
        where: {
          isActive: true,
          ...(input.venue ? { venue: input.venue } : {})
        },
        orderBy: [{ venue: 'asc' }, { area: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }]
      })
    ]);

    return {
      start: start.toISOString(),
      end: end.toISOString(),
      venue,
      reservations: reservations.map(toReservationPayload),
      tables: tables.map(toTablePayload),
      totals: {
        covers: reservations
          .filter((reservation) => !['CANCELLED', 'NO_SHOW'].includes(reservation.status))
          .reduce((sum, reservation) => sum + reservation.covers, 0),
        confirmed: reservations.filter((reservation) => reservation.status === 'CONFIRMED').length,
        seated: reservations.filter((reservation) => reservation.status === 'SEATED').length,
        completed: reservations.filter((reservation) => reservation.status === 'COMPLETED').length,
        cancelled: reservations.filter((reservation) => reservation.status === 'CANCELLED').length,
        noShow: reservations.filter((reservation) => reservation.status === 'NO_SHOW').length
      }
    };
  },

  async listGuests() {
    const guests = await prisma.reserveGuest.findMany({
      orderBy: [{ updatedAt: 'desc' }],
      take: 100
    });
    return guests.map(toGuestPayload);
  },

  async createGuest(input: unknown) {
    return toGuestPayload(await findOrCreateGuest(input));
  },

  async listTables(venue?: string) {
    const tables = await prisma.reserveTable.findMany({
      where: venue ? { venue } : {},
      orderBy: [{ venue: 'asc' }, { area: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }]
    });
    return tables.map(toTablePayload);
  },

  async createTable(input: unknown) {
    const data = reserveTableInputSchema.parse(input);
    const table = await prisma.reserveTable.upsert({
      where: {
        venue_label: {
          venue: data.venue.trim(),
          label: data.label.trim()
        }
      },
      create: {
        venue: data.venue.trim(),
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

  async createReservation(input: unknown, createdById?: string) {
    const data = reserveReservationInputSchema.parse(input);
    const startsAt = parseDate(data.startsAt, 'Reservation start time');
    const endsAt = parseDate(data.endsAt, 'Reservation end time');
    if (endsAt <= startsAt) throw new HttpError(400, 'Reservation end time must be after start time');
    const guestId = data.guestId || (data.guest ? (await findOrCreateGuest(data.guest)).id : '');
    if (!guestId) throw new HttpError(400, 'Reservation needs a guest');

    const reservation = await prisma.reserveReservation.create({
      data: {
        venue: data.venue.trim(),
        serviceDate: startOfDay(parseDate(data.serviceDate, 'Service date')),
        servicePeriod: data.servicePeriod,
        startsAt,
        endsAt,
        covers: data.covers,
        status: data.status,
        source: data.source?.trim() || 'manager',
        tableId: data.tableId?.trim() || null,
        guestId,
        occasion: data.occasion?.trim() || null,
        notes: data.notes?.trim() || null,
        createdById: createdById ?? null
      },
      include: { guest: true, table: true }
    });

    return toReservationPayload(reservation);
  },

  async updateReservation(id: string, input: unknown) {
    const data = reserveReservationUpdateInputSchema.parse(input);
    const patch: Record<string, unknown> = {};
    if (data.venue !== undefined) patch.venue = data.venue.trim();
    if (data.serviceDate !== undefined) patch.serviceDate = startOfDay(parseDate(data.serviceDate, 'Service date'));
    if (data.servicePeriod !== undefined) patch.servicePeriod = data.servicePeriod;
    if (data.startsAt !== undefined) patch.startsAt = parseDate(data.startsAt, 'Reservation start time');
    if (data.endsAt !== undefined) patch.endsAt = parseDate(data.endsAt, 'Reservation end time');
    if (data.covers !== undefined) patch.covers = data.covers;
    if (data.status !== undefined) patch.status = data.status;
    if (data.source !== undefined) patch.source = data.source.trim() || 'manager';
    if (data.tableId !== undefined) patch.tableId = data.tableId.trim() || null;
    if (data.occasion !== undefined) patch.occasion = data.occasion.trim() || null;
    if (data.notes !== undefined) patch.notes = data.notes.trim() || null;

    const reservation = await prisma.reserveReservation.update({
      where: { id },
      data: patch,
      include: { guest: true, table: true }
    });
    return toReservationPayload(reservation);
  }
};
