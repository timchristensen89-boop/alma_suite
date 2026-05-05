import { prisma } from '@alma/db';
import {
  marketingCampaignInputSchema,
  marketingCampaignUpdateInputSchema,
  marketingContactInputSchema,
  marketingContactUpdateInputSchema,
  marketingSegmentInputSchema
} from '@alma/shared';
import type { Prisma } from '@prisma/client';
import { HttpError } from '../lib/http.js';

function parseOptionalDate(value: string | undefined, label: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `${label} is invalid`);
  return date;
}

function toContactPayload(contact: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  venue: string | null;
  source: string;
  tags: string[];
  consentEmail: boolean;
  consentSms: boolean;
  totalVisits: number;
  lastVisitAt: Date | null;
  allergyNotes: string | null;
  notes: string | null;
  reserveGuestId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...contact,
    lastVisitAt: contact.lastVisitAt?.toISOString() ?? null,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString()
  };
}

function toSegmentPayload(segment: {
  id: string;
  name: string;
  description: string | null;
  venue: string | null;
  rules: Prisma.JsonValue;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...segment,
    rules: (segment.rules && typeof segment.rules === 'object' && !Array.isArray(segment.rules)) ? segment.rules : {},
    createdAt: segment.createdAt.toISOString(),
    updatedAt: segment.updatedAt.toISOString()
  };
}

function toCampaignPayload(campaign: {
  id: string;
  name: string;
  channel: 'EMAIL' | 'SMS';
  status: 'DRAFT' | 'READY' | 'SENT' | 'ARCHIVED';
  audienceName: string | null;
  subject: string | null;
  previewText: string | null;
  body: string;
  scheduledFor: Date | null;
  sentAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  recipients: Array<{
    id: string;
    campaignId: string;
    contactId: string;
    status: string;
    sentAt: Date | null;
    error: string | null;
    createdAt: Date;
    contact: Parameters<typeof toContactPayload>[0];
  }>;
}) {
  return {
    ...campaign,
    scheduledFor: campaign.scheduledFor?.toISOString() ?? null,
    sentAt: campaign.sentAt?.toISOString() ?? null,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
    recipients: campaign.recipients.map((recipient) => ({
      ...recipient,
      sentAt: recipient.sentAt?.toISOString() ?? null,
      createdAt: recipient.createdAt.toISOString(),
      contact: toContactPayload(recipient.contact)
    }))
  };
}

function contactData(input: ReturnType<typeof marketingContactInputSchema.parse>) {
  return {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    venue: input.venue?.trim() || null,
    source: input.source?.trim() || 'manual',
    tags: input.tags.map((tag) => tag.trim()).filter(Boolean),
    consentEmail: input.consentEmail,
    consentSms: input.consentSms,
    totalVisits: input.totalVisits,
    lastVisitAt: parseOptionalDate(input.lastVisitAt, 'Last visit date'),
    allergyNotes: input.allergyNotes?.trim() || null,
    notes: input.notes?.trim() || null,
    reserveGuestId: input.reserveGuestId?.trim() || null
  };
}

async function selectedContacts(contactIds: string[], channel: 'EMAIL' | 'SMS') {
  if (contactIds.length > 0) {
    return prisma.marketingContact.findMany({
      where: { id: { in: contactIds } },
      orderBy: [{ updatedAt: 'desc' }]
    });
  }

  return prisma.marketingContact.findMany({
    where: channel === 'EMAIL' ? { consentEmail: true, email: { not: null } } : { consentSms: true, phone: { not: null } },
    orderBy: [{ updatedAt: 'desc' }],
    take: 500
  });
}

export const marketingService = {
  async overview(input: { venue?: string }) {
    const venue = input.venue?.trim();
    const where = venue ? { venue } : {};

    const [contacts, segments, campaigns, totals] = await Promise.all([
      prisma.marketingContact.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        take: 200
      }),
      prisma.marketingSegment.findMany({
        where: venue ? { OR: [{ venue }, { venue: null }] } : {},
        orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }]
      }),
      prisma.marketingCampaign.findMany({
        orderBy: [{ updatedAt: 'desc' }],
        take: 50,
        include: {
          recipients: {
            include: { contact: true },
            orderBy: [{ createdAt: 'desc' }],
            take: 200
          }
        }
      }),
      prisma.marketingContact.aggregate({
        where,
        _count: {
          id: true,
          consentEmail: true,
          consentSms: true,
          reserveGuestId: true
        }
      })
    ]);

    const [draftCampaigns, readyCampaigns] = await Promise.all([
      prisma.marketingCampaign.count({ where: { status: 'DRAFT' } }),
      prisma.marketingCampaign.count({ where: { status: 'READY' } })
    ]);

    return {
      contacts: contacts.map(toContactPayload),
      segments: segments.map(toSegmentPayload),
      campaigns: campaigns.map(toCampaignPayload),
      totals: {
        contacts: totals._count.id,
        emailConsent: contacts.filter((contact) => contact.consentEmail && contact.email).length,
        smsConsent: contacts.filter((contact) => contact.consentSms && contact.phone).length,
        draftCampaigns,
        readyCampaigns,
        reserveGuestContacts: totals._count.reserveGuestId
      }
    };
  },

  async createContact(input: unknown) {
    const data = contactData(marketingContactInputSchema.parse(input));
    const existing = data.reserveGuestId || data.email || data.phone
      ? await prisma.marketingContact.findFirst({
        where: {
          OR: [
            ...(data.reserveGuestId ? [{ reserveGuestId: data.reserveGuestId }] : []),
            ...(data.email ? [{ email: data.email }] : []),
            ...(data.phone ? [{ phone: data.phone }] : [])
          ]
        }
      })
      : null;

    const contact = existing
      ? await prisma.marketingContact.update({ where: { id: existing.id }, data })
      : await prisma.marketingContact.create({ data });
    return toContactPayload(contact);
  },

  async updateContact(id: string, input: unknown) {
    const data = marketingContactUpdateInputSchema.parse(input);
    const patch: Prisma.MarketingContactUpdateInput = {};
    if (data.firstName !== undefined) patch.firstName = data.firstName.trim();
    if (data.lastName !== undefined) patch.lastName = data.lastName.trim();
    if (data.email !== undefined) patch.email = data.email.trim() || null;
    if (data.phone !== undefined) patch.phone = data.phone.trim() || null;
    if (data.venue !== undefined) patch.venue = data.venue.trim() || null;
    if (data.source !== undefined) patch.source = data.source.trim() || 'manual';
    if (data.tags !== undefined) patch.tags = data.tags.map((tag) => tag.trim()).filter(Boolean);
    if (data.consentEmail !== undefined) patch.consentEmail = data.consentEmail;
    if (data.consentSms !== undefined) patch.consentSms = data.consentSms;
    if (data.totalVisits !== undefined) patch.totalVisits = data.totalVisits;
    if (data.lastVisitAt !== undefined) patch.lastVisitAt = parseOptionalDate(data.lastVisitAt, 'Last visit date');
    if (data.allergyNotes !== undefined) patch.allergyNotes = data.allergyNotes.trim() || null;
    if (data.notes !== undefined) patch.notes = data.notes.trim() || null;

    return toContactPayload(await prisma.marketingContact.update({ where: { id }, data: patch }));
  },

  async syncReserveGuests() {
    const guests = await prisma.reserveGuest.findMany({
      include: { reservations: { orderBy: [{ startsAt: 'desc' }] } },
      orderBy: [{ updatedAt: 'desc' }],
      take: 500
    });

    let imported = 0;
    for (const guest of guests) {
      const latest = guest.reservations[0];
      await prisma.marketingContact.upsert({
        where: { reserveGuestId: guest.id },
        create: {
          firstName: guest.firstName,
          lastName: guest.lastName,
          email: guest.email,
          phone: guest.phone,
          venue: latest?.venue ?? null,
          source: 'reserve',
          tags: guest.tags,
          consentEmail: Boolean(guest.email),
          consentSms: false,
          totalVisits: guest.reservations.length,
          lastVisitAt: latest?.startsAt ?? null,
          allergyNotes: guest.allergyNotes,
          notes: guest.visitNotes,
          reserveGuestId: guest.id
        },
        update: {
          firstName: guest.firstName,
          lastName: guest.lastName,
          email: guest.email,
          phone: guest.phone,
          venue: latest?.venue ?? null,
          source: 'reserve',
          tags: guest.tags,
          totalVisits: guest.reservations.length,
          lastVisitAt: latest?.startsAt ?? null,
          allergyNotes: guest.allergyNotes,
          notes: guest.visitNotes
        }
      });
      imported += 1;
    }

    return { ok: true, imported };
  },

  async createSegment(input: unknown) {
    const data = marketingSegmentInputSchema.parse(input);
    const segment = await prisma.marketingSegment.create({
      data: {
        name: data.name.trim(),
        description: data.description?.trim() || null,
        venue: data.venue?.trim() || null,
        rules: data.rules as Prisma.InputJsonValue,
        isActive: data.isActive
      }
    });
    return toSegmentPayload(segment);
  },

  async createCampaign(input: unknown, createdById?: string) {
    const data = marketingCampaignInputSchema.parse(input);
    const contacts = await selectedContacts(data.contactIds, data.channel);
    const campaign = await prisma.marketingCampaign.create({
      data: {
        name: data.name.trim(),
        channel: data.channel,
        status: data.status,
        audienceName: data.audienceName?.trim() || null,
        subject: data.subject?.trim() || null,
        previewText: data.previewText?.trim() || null,
        body: data.body.trim(),
        scheduledFor: parseOptionalDate(data.scheduledFor, 'Scheduled date'),
        createdById: createdById ?? null,
        recipients: {
          create: contacts.map((contact) => ({
            contactId: contact.id,
            status: 'QUEUED'
          }))
        }
      },
      include: { recipients: { include: { contact: true } } }
    });

    return toCampaignPayload(campaign);
  },

  async updateCampaign(id: string, input: unknown) {
    const data = marketingCampaignUpdateInputSchema.parse(input);
    const patch: Prisma.MarketingCampaignUpdateInput = {};
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.channel !== undefined) patch.channel = data.channel;
    if (data.status !== undefined) patch.status = data.status;
    if (data.audienceName !== undefined) patch.audienceName = data.audienceName.trim() || null;
    if (data.subject !== undefined) patch.subject = data.subject.trim() || null;
    if (data.previewText !== undefined) patch.previewText = data.previewText.trim() || null;
    if (data.body !== undefined) patch.body = data.body.trim();
    if (data.scheduledFor !== undefined) patch.scheduledFor = parseOptionalDate(data.scheduledFor, 'Scheduled date');

    const campaign = await prisma.marketingCampaign.update({
      where: { id },
      data: patch,
      include: { recipients: { include: { contact: true } } }
    });
    return toCampaignPayload(campaign);
  }
};
