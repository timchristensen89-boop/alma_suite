import { prisma } from '@alma/db';
import {
  defaultRuleForSlug,
  guestMatchesRule,
  isMeaningfulRule,
  type GuestFacts,
  type GuestTagRule
} from '@alma/shared';

/**
 * The guest database, kept true to the bookings behind it.
 *
 * This is the asset that has to outlive whichever reservation system the venue
 * is on. Everything here derives from facts any booking system supplies — did
 * they come, when, how often, did they not show — so switching from SevenRooms
 * to OpenTable changes where reservations arrive from and nothing else.
 *
 * Two jobs: roll reservations up onto the guest, then apply the automatic tags
 * to the result. Both are idempotent, because they run nightly and re-running
 * one must never double-count a visit or duplicate a tag.
 */

/** A completed booking is a visit. A confirmed one that hasn't happened isn't. */
const VISIT_STATUSES = ['COMPLETED', 'SEATED'] as const;

export const guestCrmService = {
  /**
   * Recompute totalVisits, first/last visit and no-shows from reservations.
   *
   * These columns exist on the guest and were, on this database, populated for
   * exactly one of 2,370 guests — so every question about who is loyal, who has
   * lapsed and who does not turn up was unanswerable despite the reservations
   * being right there.
   *
   * Spend is deliberately not touched. No spend reaches this database yet: the
   * POS does not tell it who ate. Writing a zero would be indistinguishable
   * from a guest who genuinely spent nothing, so the column stays untouched
   * until there is a real number for it.
   */
  async rebuildGuestRollups() {
    const grouped = await prisma.reserveReservation.groupBy({
      by: ['guestId', 'status'],
      _count: { _all: true },
      _min: { serviceDate: true },
      _max: { serviceDate: true }
    });

    type Roll = { visits: number; noShows: number; first: Date | null; last: Date | null };
    const rolls = new Map<string, Roll>();
    for (const row of grouped) {
      const roll = rolls.get(row.guestId) ?? { visits: 0, noShows: 0, first: null, last: null };
      if ((VISIT_STATUSES as readonly string[]).includes(row.status)) {
        roll.visits += row._count._all;
        const min = row._min.serviceDate;
        const max = row._max.serviceDate;
        if (min && (!roll.first || min < roll.first)) roll.first = min;
        if (max && (!roll.last || max > roll.last)) roll.last = max;
      }
      if (row.status === 'NO_SHOW') roll.noShows += row._count._all;
      rolls.set(row.guestId, roll);
    }

    const guests = await prisma.reserveGuest.findMany({
      select: { id: true, totalVisits: true, noShowCount: true, firstVisitAt: true, lastVisitAt: true }
    });

    let updated = 0;
    for (const guest of guests) {
      const roll = rolls.get(guest.id) ?? { visits: 0, noShows: 0, first: null, last: null };
      const same =
        guest.totalVisits === roll.visits &&
        guest.noShowCount === roll.noShows &&
        guest.firstVisitAt?.getTime() === roll.first?.getTime() &&
        guest.lastVisitAt?.getTime() === roll.last?.getTime();
      // Only write rows that actually changed — a nightly job that touches
      // every row makes updatedAt useless for spotting real movement.
      if (same) continue;
      await prisma.reserveGuest.update({
        where: { id: guest.id },
        data: {
          totalVisits: roll.visits,
          noShowCount: roll.noShows,
          firstVisitAt: roll.first,
          lastVisitAt: roll.last
        }
      });
      updated += 1;
    }

    return { guests: guests.length, updated, generatedAt: new Date().toISOString() };
  },

  /**
   * Apply every automatic tag to every guest.
   *
   * Adds what now matches and removes what no longer does — a "lapsed guest"
   * who books again must stop being lapsed, or the tag becomes a record of
   * something that was once true rather than a segment you can email.
   *
   * Only AUTOMATIC and SYSTEM assignments are touched. A tag a manager put on
   * by hand is theirs and survives.
   */
  async applyAutomaticTags(options: { dryRun?: boolean } = {}) {
    const now = new Date();
    const tags = await prisma.guestTag.findMany({
      where: { active: true, type: { in: ['AUTOMATIC', 'SYSTEM'] } }
    });

    const usable = tags
      .map((tag) => ({ tag, rule: (tag.ruleDefinition ?? {}) as GuestTagRule }))
      .filter((entry) => isMeaningfulRule(entry.rule));
    const skipped = tags.length - usable.length;

    if (usable.length === 0) {
      return {
        applied: 0,
        removed: 0,
        tagsEvaluated: 0,
        // Worth saying out loud: the tags shipped with empty definitions, and
        // a silent zero here looks identical to "nobody qualified".
        skippedWithoutRules: skipped,
        dryRun: options.dryRun === true,
        generatedAt: now.toISOString()
      };
    }

    const guests = await prisma.reserveGuest.findMany({
      select: {
        id: true,
        totalVisits: true,
        noShowCount: true,
        totalSpendCents: true,
        firstVisitAt: true,
        lastVisitAt: true,
        birthday: true,
        marketingOptIn: true
      }
    });

    const existing = await prisma.guestTagAssignment.findMany({
      where: { tagId: { in: usable.map((entry) => entry.tag.id) }, source: { in: ['AUTOMATIC', 'SYSTEM'] } },
      select: { id: true, guestId: true, tagId: true }
    });
    const held = new Set(existing.map((row) => `${row.guestId}:${row.tagId}`));

    const toAdd: Array<{ guestId: string; tagId: string }> = [];
    const keep = new Set<string>();

    for (const guest of guests) {
      const facts: GuestFacts = {
        totalVisits: guest.totalVisits,
        noShowCount: guest.noShowCount,
        totalSpendCents: guest.totalSpendCents,
        firstVisitAt: guest.firstVisitAt,
        lastVisitAt: guest.lastVisitAt,
        birthday: guest.birthday,
        marketingOptIn: guest.marketingOptIn
      };
      for (const { tag, rule } of usable) {
        if (!guestMatchesRule(facts, rule, now)) continue;
        const key = `${guest.id}:${tag.id}`;
        keep.add(key);
        if (!held.has(key)) toAdd.push({ guestId: guest.id, tagId: tag.id });
      }
    }

    const stale = existing.filter((row) => !keep.has(`${row.guestId}:${row.tagId}`));

    if (options.dryRun) {
      return {
        applied: toAdd.length,
        removed: stale.length,
        tagsEvaluated: usable.length,
        skippedWithoutRules: skipped,
        dryRun: true,
        generatedAt: now.toISOString()
      };
    }

    if (toAdd.length > 0) {
      await prisma.guestTagAssignment.createMany({
        data: toAdd.map((row) => ({ ...row, source: 'AUTOMATIC' as const })),
        skipDuplicates: true
      });
    }
    if (stale.length > 0) {
      await prisma.guestTagAssignment.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    }

    return {
      applied: toAdd.length,
      removed: stale.length,
      tagsEvaluated: usable.length,
      skippedWithoutRules: skipped,
      dryRun: false,
      generatedAt: now.toISOString()
    };
  },

  /**
   * Give the shipped tags a starting rule where they have none.
   *
   * Matched on slug, and only where the tag currently defines nothing, so a
   * threshold someone has since tuned is never overwritten.
   */
  async seedDefaultTagRules() {
    const tags = await prisma.guestTag.findMany({ where: { type: { in: ['AUTOMATIC', 'SYSTEM'] } } });
    let seeded = 0;
    for (const tag of tags) {
      const rule = defaultRuleForSlug(tag.slug);
      if (!rule) continue;
      if (isMeaningfulRule((tag.ruleDefinition ?? {}) as GuestTagRule)) continue;
      await prisma.guestTag.update({ where: { id: tag.id }, data: { ruleDefinition: rule } });
      seeded += 1;
    }
    return { seeded, considered: tags.length };
  },

  /**
   * What the guest database actually holds, for reporting.
   *
   * Deliberately blunt about the gaps: a CRM that reports 2,370 contacts
   * without saying only a handful can legally be emailed is worse than no
   * report.
   */
  async summary() {
    const [total, withEmail, withPhone, optedIn, visited, lapsed, tagRows] = await Promise.all([
      prisma.reserveGuest.count(),
      prisma.reserveGuest.count({ where: { email: { not: null } } }),
      prisma.reserveGuest.count({ where: { phone: { not: null } } }),
      prisma.reserveGuest.count({ where: { marketingOptIn: true, emailUnsubscribedAt: null } }),
      prisma.reserveGuest.count({ where: { totalVisits: { gt: 0 } } }),
      prisma.reserveGuest.count({
        where: { totalVisits: { gt: 0 }, lastVisitAt: { lt: new Date(Date.now() - 180 * 86_400_000) } }
      }),
      prisma.guestTagAssignment.groupBy({ by: ['tagId'], _count: { _all: true } })
    ]);

    const tags = await prisma.guestTag.findMany({ select: { id: true, name: true, slug: true, type: true } });
    const byId = new Map(tags.map((tag) => [tag.id, tag]));

    return {
      guests: total,
      withEmail,
      withPhone,
      /** The only number that matters for a campaign: who may lawfully be sent one. */
      reachableByEmail: optedIn,
      visited,
      lapsed,
      tags: tagRows
        .map((row) => ({
          id: row.tagId,
          name: byId.get(row.tagId)?.name ?? 'Unknown tag',
          slug: byId.get(row.tagId)?.slug ?? '',
          guests: row._count._all
        }))
        .sort((a, b) => b.guests - a.guests),
      generatedAt: new Date().toISOString()
    };
  }
};
