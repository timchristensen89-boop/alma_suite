import { prisma } from '@alma/db';
import {
  liquorLicenceCreateInputSchema,
  liquorLicenceUpdateInputSchema,
  type LiquorLicence,
  type LiquorLicenceSummary
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

type DbLicence = Awaited<
  ReturnType<typeof prisma.liquorLicence.findFirst>
> & object;

function toIsoDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function toPayload(row: NonNullable<DbLicence>): LiquorLicence {
  return {
    id: row.id,
    venue: row.venue,
    licenceNumber: row.licenceNumber,
    licenceType: row.licenceType,
    status: row.status,
    licensee: row.licensee,
    issuer: row.issuer,
    issueDate: toIsoDate(row.issueDate),
    expiryDate: toIsoDate(row.expiryDate),
    tradingHours: row.tradingHours,
    conditions: row.conditions,
    restrictions: row.restrictions,
    notes: row.notes,
    documentName: row.documentName,
    documentUrl: row.documentUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

/**
 * Empty-string dates come through the form as '' — convert to null,
 * otherwise pass through as a Date (Prisma accepts Date or ISO string).
 */
function normaliseDate(value: string | undefined | null) {
  if (value === undefined) return undefined; // leave field unset
  if (!value) return null;
  return new Date(value);
}

function normaliseOptionalText(value: string | undefined) {
  if (value === undefined) return undefined;
  return value.trim() || null;
}

function defaultIssuer(licenceType: string) {
  switch (licenceType) {
    case 'OUTDOOR_SEATING':
    case 'FOOTPATH_DINING':
    case 'SIGNAGE':
      return 'Northern Beaches Council';
    case 'FOOD_BUSINESS':
      return 'NSW Food Authority';
    case 'FIRE_SAFETY':
      return 'Fire and Rescue NSW';
    case 'WASTE_TRADE':
      return 'Sydney Water';
    default:
      return 'NSW Liquor & Gaming';
  }
}

export const liquorService = {
  async list(): Promise<LiquorLicence[]> {
    const rows = await prisma.liquorLicence.findMany({
      orderBy: [{ venue: 'asc' }, { expiryDate: 'asc' }]
    });
    return rows.map(toPayload);
  },

  async get(id: string): Promise<LiquorLicence> {
    const row = await prisma.liquorLicence.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, 'Licence not found');
    return toPayload(row);
  },

  async create(input: unknown): Promise<LiquorLicence> {
    const data = liquorLicenceCreateInputSchema.parse(input);

    // Licence numbers are unique; short-circuit with a nicer error.
    const existing = await prisma.liquorLicence.findUnique({
      where: { licenceNumber: data.licenceNumber }
    });
    if (existing) {
      throw new HttpError(409, 'A licence with that number already exists');
    }

    const row = await prisma.liquorLicence.create({
      data: {
        venue: data.venue,
        licenceNumber: data.licenceNumber.trim(),
        licenceType: data.licenceType,
        status: data.status,
        licensee: data.licensee.trim(),
        issuer: data.issuer?.trim() || defaultIssuer(data.licenceType),
        issueDate: normaliseDate(data.issueDate) ?? null,
        expiryDate: normaliseDate(data.expiryDate) ?? null,
        tradingHours: normaliseOptionalText(data.tradingHours) ?? null,
        conditions: normaliseOptionalText(data.conditions) ?? null,
        restrictions: normaliseOptionalText(data.restrictions) ?? null,
        notes: normaliseOptionalText(data.notes) ?? null,
        documentName: normaliseOptionalText(data.documentName) ?? null,
        documentUrl: normaliseOptionalText(data.documentUrl) ?? null
      }
    });

    return toPayload(row);
  },

  async update(id: string, input: unknown): Promise<LiquorLicence> {
    const data = liquorLicenceUpdateInputSchema.parse(input);
    const existing = await prisma.liquorLicence.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Licence not found');

    // Guard uniqueness if the licence number is being changed.
    if (
      data.licenceNumber !== undefined &&
      data.licenceNumber.trim() !== existing.licenceNumber
    ) {
      const conflict = await prisma.liquorLicence.findUnique({
        where: { licenceNumber: data.licenceNumber.trim() }
      });
      if (conflict) {
        throw new HttpError(409, 'A licence with that number already exists');
      }
    }

    const row = await prisma.liquorLicence.update({
      where: { id },
      data: {
        ...(data.venue !== undefined && { venue: data.venue }),
        ...(data.licenceNumber !== undefined && {
          licenceNumber: data.licenceNumber.trim()
        }),
        ...(data.licenceType !== undefined && { licenceType: data.licenceType }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.licensee !== undefined && { licensee: data.licensee.trim() }),
        ...(data.issuer !== undefined && {
          issuer: data.issuer.trim() || defaultIssuer(data.licenceType ?? existing.licenceType)
        }),
        ...(data.issueDate !== undefined && {
          issueDate: normaliseDate(data.issueDate)
        }),
        ...(data.expiryDate !== undefined && {
          expiryDate: normaliseDate(data.expiryDate)
        }),
        ...(data.tradingHours !== undefined && {
          tradingHours: normaliseOptionalText(data.tradingHours)
        }),
        ...(data.conditions !== undefined && {
          conditions: normaliseOptionalText(data.conditions)
        }),
        ...(data.restrictions !== undefined && {
          restrictions: normaliseOptionalText(data.restrictions)
        }),
        ...(data.notes !== undefined && {
          notes: normaliseOptionalText(data.notes)
        }),
        ...(data.documentName !== undefined && {
          documentName: normaliseOptionalText(data.documentName)
        }),
        ...(data.documentUrl !== undefined && {
          documentUrl: normaliseOptionalText(data.documentUrl)
        })
      }
    });

    return toPayload(row);
  },

  async remove(id: string) {
    const existing = await prisma.liquorLicence.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Licence not found');
    await prisma.liquorLicence.delete({ where: { id } });
  },

  async summary(): Promise<LiquorLicenceSummary> {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [total, active, suspended, expired, expiringSoon] = await Promise.all([
      prisma.liquorLicence.count(),
      prisma.liquorLicence.count({ where: { status: 'ACTIVE' } }),
      prisma.liquorLicence.count({ where: { status: 'SUSPENDED' } }),
      prisma.liquorLicence.count({
        where: {
          OR: [
            { status: 'EXPIRED' },
            { expiryDate: { lt: now } }
          ]
        }
      }),
      prisma.liquorLicence.count({
        where: {
          status: { not: 'EXPIRED' },
          expiryDate: { gte: now, lte: in30 }
        }
      })
    ]);

    return { total, active, suspended, expired, expiringSoon };
  }
};
