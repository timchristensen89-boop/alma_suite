import type { Supplier as SupplierRow } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  supplierBulkDeleteInputSchema,
  supplierCreateInputSchema,
  supplierUpdateInputSchema,
  type Supplier,
  type SuppliersPayload,
  type SuppliersSummary
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

function normaliseOptionalText(value: string | undefined) {
  if (value === undefined) return undefined;
  return value.trim() || null;
}

function toSupplierPayload(row: SupplierRow): Supplier {
  return {
    id: row.id,
    legacyId: row.legacyId,
    name: row.name,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    website: row.website,
    address: row.address,
    accountNumber: row.accountNumber,
    paymentTerms: row.paymentTerms,
    notes: row.notes,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export const suppliersService = {
  async list(): Promise<SuppliersPayload> {
    const suppliers = await prisma.supplier.findMany({
      orderBy: [{ status: 'asc' }, { name: 'asc' }]
    });
    return { suppliers: suppliers.map(toSupplierPayload) };
  },

  async summary(): Promise<SuppliersSummary> {
    const [totalSuppliers, activeSuppliers, archivedSuppliers] = await Promise.all([
      prisma.supplier.count(),
      prisma.supplier.count({ where: { status: 'ACTIVE' } }),
      prisma.supplier.count({ where: { status: 'ARCHIVED' } })
    ]);
    return { totalSuppliers, activeSuppliers, archivedSuppliers };
  },

  async createSupplier(input: unknown): Promise<Supplier> {
    const data = supplierCreateInputSchema.parse(input);
    const row = await prisma.supplier.create({
      data: {
        name: data.name.trim(),
        contactName: normaliseOptionalText(data.contactName) ?? null,
        email: normaliseOptionalText(data.email) ?? null,
        phone: normaliseOptionalText(data.phone) ?? null,
        website: normaliseOptionalText(data.website) ?? null,
        address: normaliseOptionalText(data.address) ?? null,
        accountNumber: normaliseOptionalText(data.accountNumber) ?? null,
        paymentTerms: normaliseOptionalText(data.paymentTerms) ?? null,
        notes: normaliseOptionalText(data.notes) ?? null,
        status: data.status
      }
    });
    return toSupplierPayload(row);
  },

  async updateSupplier(id: string, input: unknown): Promise<Supplier> {
    const data = supplierUpdateInputSchema.parse(input);
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Supplier not found');

    const row = await prisma.supplier.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.contactName !== undefined && {
          contactName: normaliseOptionalText(data.contactName)
        }),
        ...(data.email !== undefined && { email: normaliseOptionalText(data.email) }),
        ...(data.phone !== undefined && { phone: normaliseOptionalText(data.phone) }),
        ...(data.website !== undefined && { website: normaliseOptionalText(data.website) }),
        ...(data.address !== undefined && { address: normaliseOptionalText(data.address) }),
        ...(data.accountNumber !== undefined && {
          accountNumber: normaliseOptionalText(data.accountNumber)
        }),
        ...(data.paymentTerms !== undefined && {
          paymentTerms: normaliseOptionalText(data.paymentTerms)
        }),
        ...(data.notes !== undefined && { notes: normaliseOptionalText(data.notes) }),
        ...(data.status !== undefined && { status: data.status })
      }
    });
    return toSupplierPayload(row);
  },

  async deleteSuppliers(input: unknown): Promise<{ deleted: number }> {
    const { ids } = supplierBulkDeleteInputSchema.parse(input);
    const uniqueIds = Array.from(new Set(ids));
    const invoiceLinks = await prisma.supplierInvoice.findMany({
      where: { supplierId: { in: uniqueIds } },
      select: { supplierId: true },
      distinct: ['supplierId']
    });
    const referencedIds = invoiceLinks.flatMap((row) => (row.supplierId ? [row.supplierId] : []));
    if (referencedIds.length > 0) {
      const referencedSuppliers = await prisma.supplier.findMany({
        where: { id: { in: referencedIds } },
        select: { name: true },
        orderBy: { name: 'asc' },
        take: 3
      });
      const sample = referencedSuppliers.map((supplier) => supplier.name).join(', ');
      throw new HttpError(
        409,
        `Cannot delete ${referencedIds.length} supplier${referencedIds.length === 1 ? '' : 's'} because ${referencedIds.length === 1 ? 'it has' : 'they have'} imported invoices. Archive suppliers instead.${sample ? ` Affected: ${sample}${referencedIds.length > 3 ? ', ...' : ''}` : ''}`
      );
    }
    const result = await prisma.supplier.deleteMany({
      where: { id: { in: uniqueIds } }
    });
    return { deleted: result.count };
  }
};
