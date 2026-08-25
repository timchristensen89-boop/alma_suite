import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import { normalisePhone } from '@alma/shared';
import { HttpError } from '../lib/http.js';
import {
  creditCentsFor,
  loyaltyEarnBaseCents,
  parseLoyaltySettings,
  pointsEarned,
  pointsNeededFor,
  type LoyaltySettings
} from '../lib/loyalty-maths.js';

/**
 * Loyalty: points on spend, redeemable as credit at the register.
 *
 * A member IS a guest — loyalty fields live on ReserveGuest, so a regular who
 * books through Reserve and a walk-in who joined at the till are the same
 * person with the same points, visits and spend. One balance, both venues.
 *
 * `ReserveGuest.loyaltyPoints` is a cached balance for fast register reads;
 * `LoyaltyLedgerEntry` is the audit trail. They only ever move together, in
 * one transaction, and redemption decrements conditionally (`points >= needed`)
 * so two tills racing on one member can never spend the same points twice.
 */

const SINGLETON_ID = 'singleton';

export type LoyaltyMemberSummary = {
  guestId: string;
  code: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  points: number;
  creditCents: number;
  pointValueCents: number;
  minRedeemPoints: number;
};

async function loyaltySettings(): Promise<LoyaltySettings> {
  const row = await prisma.appSettings.findUnique({ where: { id: SINGLETON_ID }, select: { loyaltySettings: true } });
  return parseLoyaltySettings(row?.loyaltySettings);
}

function memberSummary(
  guest: { id: string; loyaltyCode: string | null; firstName: string; lastName: string; phone: string | null; loyaltyPoints: number },
  settings: LoyaltySettings
): LoyaltyMemberSummary {
  return {
    guestId: guest.id,
    code: guest.loyaltyCode ?? '',
    firstName: guest.firstName,
    lastName: guest.lastName,
    phone: guest.phone,
    points: guest.loyaltyPoints,
    creditCents: creditCentsFor(guest.loyaltyPoints, settings),
    pointValueCents: settings.pointValueCents,
    minRedeemPoints: settings.minRedeemPoints
  };
}

async function freshLoyaltyCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `LOY-${randomBytes(3).toString('hex').toUpperCase()}`;
    const clash = await prisma.reserveGuest.findUnique({ where: { loyaltyCode: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  throw new HttpError(500, 'Could not generate a loyalty code — try again.');
}

const MEMBER_SELECT = {
  id: true,
  loyaltyCode: true,
  firstName: true,
  lastName: true,
  phone: true,
  loyaltyPoints: true
} as const;

export const loyaltyService = {
  async settings() {
    return loyaltySettings();
  },

  async updateSettings(input: unknown) {
    const parsed = parseLoyaltySettings(input);
    await prisma.appSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, loyaltySettings: parsed },
      update: { loyaltySettings: parsed }
    });
    return parsed;
  },

  /**
   * Join at the till: phone is the identity. An existing guest with that
   * phone (however the number was formatted when Reserve captured it) becomes
   * the member — their visits and spend history come with them — otherwise a
   * guest is created. Joining twice is a no-op that returns the member.
   */
  async join(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const digits = normalisePhone(rawPhone);
    if (!digits) throw new HttpError(400, 'A phone number is required to join — it is how the member is found next visit.');
    const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
    const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
    const email = typeof body.email === 'string' && body.email.includes('@') ? body.email.trim() : null;
    const venue = typeof body.venue === 'string' ? body.venue.trim() : null;

    // Phone match against however Reserve stored the number: strip formatting
    // in SQL and compare the trailing digits normalisePhone keeps.
    const matches = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "ReserveGuest"
      WHERE regexp_replace(coalesce("phone", ''), '\\D', '', 'g') LIKE ${'%' + digits}
      ORDER BY "loyaltyJoinedAt" ASC NULLS LAST, "totalVisits" DESC
      LIMIT 1
    `);

    const settings = await loyaltySettings();
    if (matches.length > 0) {
      const existing = await prisma.reserveGuest.findUnique({ where: { id: matches[0]!.id }, select: MEMBER_SELECT });
      if (existing?.loyaltyCode) return { member: memberSummary(existing, settings), alreadyMember: true };
      const code = await freshLoyaltyCode();
      const updated = await prisma.reserveGuest.update({
        where: { id: matches[0]!.id },
        data: {
          loyaltyCode: code,
          loyaltyJoinedAt: new Date(),
          ...(firstName && existing?.firstName === 'Guest' ? { firstName } : {}),
          ...(lastName && !existing?.lastName ? { lastName } : {}),
          ...(email ? { email } : {})
        },
        select: MEMBER_SELECT
      });
      return { member: memberSummary(updated, settings), alreadyMember: false };
    }

    const code = await freshLoyaltyCode();
    const created = await prisma.reserveGuest.create({
      data: {
        firstName: firstName || 'Guest',
        lastName,
        phone: rawPhone,
        email,
        venue,
        source: 'loyalty_join',
        loyaltyCode: code,
        loyaltyJoinedAt: new Date()
      },
      select: MEMBER_SELECT
    });
    return { member: memberSummary(created, settings), alreadyMember: false };
  },

  /** Find a member by loyalty code or phone number. */
  async memberByHandle(handle: string): Promise<LoyaltyMemberSummary> {
    const trimmed = handle.trim();
    if (!trimmed) throw new HttpError(400, 'Enter a phone number or loyalty code.');
    const settings = await loyaltySettings();

    if (/^LOY-/i.test(trimmed)) {
      const guest = await prisma.reserveGuest.findUnique({
        where: { loyaltyCode: trimmed.toUpperCase() },
        select: MEMBER_SELECT
      });
      if (!guest) throw new HttpError(404, 'No member with that code.');
      return memberSummary(guest, settings);
    }

    const digits = normalisePhone(trimmed);
    if (!digits) throw new HttpError(400, 'That does not look like a phone number or a LOY- code.');
    // Members only — a phone can sit on several guest rows from years of
    // bookings, but at most one of them is the loyalty member.
    const members = await prisma.reserveGuest.findMany({
      where: { loyaltyJoinedAt: { not: null } },
      select: MEMBER_SELECT
    });
    const match = members.find((member) => normalisePhone(member.phone) === digits);
    if (!match) throw new HttpError(404, 'No member with that phone number — join them first.');
    return memberSummary(match, settings);
  },

  async summary(guestId: string): Promise<LoyaltyMemberSummary | null> {
    const guest = await prisma.reserveGuest.findUnique({ where: { id: guestId }, select: MEMBER_SELECT });
    if (!guest?.loyaltyCode) return null;
    return memberSummary(guest, await loyaltySettings());
  },

  /**
   * Award points for a settled order. Idempotent: earnKey is the order id and
   * unique, so a replayed settle (offline sync, double tap) can never award
   * twice. Silently does nothing when the programme is off, the order is
   * training, or the guest is not a member.
   */
  async earnForOrder(order: {
    id: string;
    venue: string;
    guestId: string | null;
    training: boolean;
    totalCents: number;
    lines: Array<{ isGiftCard: boolean; totalCents: number }>;
    payments: Array<{ method: string; amountCents: number }>;
  }) {
    if (!order.guestId || order.training) return null;
    const settings = await loyaltySettings();
    if (!settings.active) return null;
    const guest = await prisma.reserveGuest.findUnique({
      where: { id: order.guestId },
      select: { id: true, loyaltyJoinedAt: true }
    });
    if (!guest?.loyaltyJoinedAt) return null;

    const giftCardLineCents = order.lines.filter((line) => line.isGiftCard).reduce((sum, line) => sum + line.totalCents, 0);
    const loyaltyPaidCents = order.payments.filter((payment) => payment.method === 'LOYALTY').reduce((sum, payment) => sum + payment.amountCents, 0);
    const base = loyaltyEarnBaseCents({ totalCents: order.totalCents, giftCardLineCents, loyaltyPaidCents });
    const points = pointsEarned(base, settings);
    if (points <= 0) return null;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.loyaltyLedgerEntry.create({
          data: {
            guestId: order.guestId!,
            venue: order.venue,
            kind: 'EARN',
            points,
            orderCents: base,
            posOrderId: order.id,
            earnKey: order.id
          }
        });
        await tx.reserveGuest.update({ where: { id: order.guestId! }, data: { loyaltyPoints: { increment: points } } });
      });
    } catch (error) {
      // Unique earnKey: this order already awarded its points.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
    return points;
  },

  /**
   * Spend points as payment. Called by the pay flow BEFORE the payment row is
   * recorded, mirroring the gift-card order of operations: a failed debit
   * must leave the bill untouched.
   */
  async redeemForOrder(input: { guestId: string; orderId: string; amountCents: number; venue: string }) {
    const settings = await loyaltySettings();
    if (!settings.active) throw new HttpError(400, 'Loyalty is switched off right now.');
    const guest = await prisma.reserveGuest.findUnique({
      where: { id: input.guestId },
      select: MEMBER_SELECT
    });
    if (!guest?.loyaltyCode) throw new HttpError(400, 'This bill has no loyalty member attached.');
    const needed = pointsNeededFor(input.amountCents, settings);
    if (needed < settings.minRedeemPoints) {
      throw new HttpError(400, `Redemptions start at ${settings.minRedeemPoints} points (${(creditCentsFor(settings.minRedeemPoints, settings) / 100).toFixed(2)} dollars).`);
    }

    await prisma.$transaction(async (tx) => {
      // Conditional decrement: the WHERE clause is the balance check, so two
      // tills racing on the same member cannot both win the same points.
      const updated = await tx.reserveGuest.updateMany({
        where: { id: input.guestId, loyaltyPoints: { gte: needed } },
        data: { loyaltyPoints: { decrement: needed } }
      });
      if (updated.count === 0) {
        throw new HttpError(400, `Not enough points — ${guest.loyaltyPoints} on the account, this needs ${needed}.`);
      }
      await tx.loyaltyLedgerEntry.create({
        data: {
          guestId: input.guestId,
          venue: input.venue,
          kind: 'REDEEM',
          points: -needed,
          orderCents: input.amountCents,
          posOrderId: input.orderId
        }
      });
    });
    const after = await prisma.reserveGuest.findUnique({ where: { id: input.guestId }, select: MEMBER_SELECT });
    return { pointsSpent: needed, member: after ? memberSummary(after, settings) : null, code: guest.loyaltyCode };
  },

  /** Manager correction — signed points, always with a note. */
  async adjust(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const guestId = typeof body.guestId === 'string' ? body.guestId : '';
    const points = Number(body.points);
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    const createdBy = typeof body.createdBy === 'string' ? body.createdBy.trim() : null;
    if (!guestId) throw new HttpError(400, 'guestId is required.');
    if (!Number.isInteger(points) || points === 0) throw new HttpError(400, 'points must be a non-zero whole number.');
    if (!note) throw new HttpError(400, 'A note explaining the adjustment is required.');

    const settings = await loyaltySettings();
    await prisma.$transaction(async (tx) => {
      const updated = await tx.reserveGuest.updateMany({
        where: { id: guestId, ...(points < 0 ? { loyaltyPoints: { gte: -points } } : {}), loyaltyJoinedAt: { not: null } },
        data: { loyaltyPoints: { increment: points } }
      });
      if (updated.count === 0) throw new HttpError(400, 'Not a member, or the deduction is more than their balance.');
      await tx.loyaltyLedgerEntry.create({ data: { guestId, kind: 'ADJUST', points, note, createdBy } });
    });
    const after = await prisma.reserveGuest.findUnique({ where: { id: guestId }, select: MEMBER_SELECT });
    return after ? memberSummary(after, settings) : null;
  },

  /** The Office view: programme health and the liability the points represent. */
  async report() {
    const settings = await loyaltySettings();
    const [memberCount, pointsAgg, recent, top] = await Promise.all([
      prisma.reserveGuest.count({ where: { loyaltyJoinedAt: { not: null } } }),
      prisma.reserveGuest.aggregate({ where: { loyaltyJoinedAt: { not: null } }, _sum: { loyaltyPoints: true } }),
      prisma.loyaltyLedgerEntry.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { guest: { select: { firstName: true, lastName: true, loyaltyCode: true } } }
      }),
      prisma.reserveGuest.findMany({
        where: { loyaltyJoinedAt: { not: null } },
        orderBy: { loyaltyPoints: 'desc' },
        take: 10,
        select: { id: true, firstName: true, lastName: true, loyaltyPoints: true, totalSpendCents: true, totalVisits: true }
      })
    ]);
    const pointsOutstanding = pointsAgg._sum.loyaltyPoints ?? 0;
    return {
      settings,
      memberCount,
      pointsOutstanding,
      liabilityCents: creditCentsFor(pointsOutstanding, settings),
      topMembers: top,
      recent: recent.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        points: entry.points,
        venue: entry.venue,
        note: entry.note,
        createdAt: entry.createdAt,
        guestName: `${entry.guest.firstName} ${entry.guest.lastName}`.trim(),
        code: entry.guest.loyaltyCode
      }))
    };
  }
};
