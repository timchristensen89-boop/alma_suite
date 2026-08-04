import { prisma } from '@alma/db';
import { decideInviteChase, INVITE_REMINDER_DAYS } from '@alma/shared';
import { mailService } from './mail.service.js';
import { handbookDocumentService } from './handbook-document.service.js';

/**
 * Chase onboarding invites that have gone quiet.
 *
 * Measured in production before this existed: 33 invites sent, 12 completed,
 * 20 expired unused and 1 still open. Nothing anywhere reported the 20 — an
 * invite expiring changed no screen and sent no email — so managers activated
 * those people anyway to get them on a roster, and payroll ended up chasing
 * tax and bank details by hand.
 *
 * The decision of what to do about a given invite is a pure function in
 * @alma/shared with tests; this is the part that talks to the database and
 * sends the mail.
 */

/** Where the invite link points when the invite did not record one. */
function inviteLinkFor(token: string) {
  const base = (process.env.STAFF_WEB_URL || 'https://alma-staff.web.app').replace(/\/+$/, '');
  return `${base}/onboarding/${token}`;
}

async function managerRecipient(venue: string | null | undefined): Promise<string | null> {
  const target = (venue ?? '').trim().toLowerCase();
  const managers = await prisma.staffProfile.findMany({
    where: {
      accountType: 'HUMAN',
      employmentStatus: 'ACTIVE',
      mergedIntoStaffProfileId: null,
      email: { not: null },
      OR: [{ isAdmin: true }, { roleTitle: { contains: 'manager', mode: 'insensitive' } }]
    },
    select: { email: true, venue: true, isAdmin: true },
    orderBy: { createdAt: 'asc' }
  });
  const atVenue = managers.find((row) => (row.venue ?? '').trim().toLowerCase() === target && !row.isAdmin);
  if (atVenue?.email) return atVenue.email;
  // No venue manager — fall back to the org notification address, then an
  // admin. Sending nowhere is what this job exists to stop.
  const settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { notifyEmail: true }
  });
  return settings?.notifyEmail?.trim() || managers.find((row) => row.isAdmin)?.email || null;
}

export const onboardingChaseService = {
  /**
   * Run one pass. Safe to run daily.
   *
   * `dryRun` reports what would be sent without sending it or marking anything,
   * because the first live run of a job that emails real people should be
   * something you can look at first.
   */
  async run(options: { dryRun?: boolean } = {}) {
    const dryRun = options.dryRun === true;
    const now = new Date();

    const outstanding = await prisma.staffInvite.findMany({
      where: { completedAt: null, expiresAt: { not: null } },
      orderBy: { createdAt: 'asc' }
    });

    const reminders: Array<{ email: string; name: string; dayNumber: number; delivery: string }> = [];
    const expiringByVenue = new Map<string, Array<{ name: string; email: string | null; daysLeft: number }>>();
    const expiredByVenue = new Map<string, Array<{ name: string; email: string | null; daysAgo: number }>>();
    let skipped = 0;

    for (const invite of outstanding) {
      const decision = decideInviteChase(
        { createdAt: invite.createdAt, expiresAt: invite.expiresAt!, completedAt: invite.completedAt },
        now,
        invite.remindersSent
      );
      if (decision.action === 'none') {
        skipped += 1;
        continue;
      }

      const profile = invite.staffProfileId
        ? await prisma.staffProfile.findUnique({
            where: { id: invite.staffProfileId },
            select: { firstName: true, lastName: true, venue: true, email: true }
          })
        : null;
      const email = invite.email ?? profile?.email ?? null;
      const name = profile ? `${profile.firstName} ${profile.lastName}`.trim() : (email ?? 'Unnamed starter');
      const venueKey = profile?.venue ?? '';

      if (decision.action === 'remind-starter') {
        if (!email) {
          // No address to nudge — this is the manager's problem, not a silent skip.
          const list = expiringByVenue.get(venueKey) ?? [];
          list.push({ name, email: null, daysLeft: 0 });
          expiringByVenue.set(venueKey, list);
          continue;
        }
        if (dryRun) {
          reminders.push({ email, name, dayNumber: decision.dayNumber, delivery: 'dry-run' });
          continue;
        }
        // Resend the handbook with the nudge: someone who never opened the
        // first email never got the documents either.
        const handbook = await handbookDocumentService.onboardingAttachments(profile?.venue ?? null);
        const daysLeft = Math.max(
          0,
          Math.floor((invite.expiresAt!.getTime() - now.getTime()) / 86_400_000)
        );
        const delivery = await mailService.sendOnboardingReminder({
          to: email,
          firstName: profile?.firstName ?? 'there',
          inviteLink: inviteLinkFor(invite.token),
          daysLeft,
          venue: profile?.venue ?? null,
          attachments: handbook.attachments
        });
        if (delivery.status === 'sent') {
          await prisma.staffInvite.update({
            where: { id: invite.id },
            data: { remindersSent: { set: [...invite.remindersSent, decision.dayNumber] } }
          });
        }
        reminders.push({ email, name, dayNumber: decision.dayNumber, delivery: delivery.status });
        continue;
      }

      if (decision.action === 'warn-manager') {
        const list = expiringByVenue.get(venueKey) ?? [];
        list.push({ name, email, daysLeft: decision.daysLeft });
        expiringByVenue.set(venueKey, list);
        continue;
      }

      if (decision.action === 'report-expired') {
        // Report an expired invite once, not every day for the rest of time.
        if (invite.managerAlertAt) {
          skipped += 1;
          continue;
        }
        const list = expiredByVenue.get(venueKey) ?? [];
        list.push({ name, email, daysAgo: decision.daysAgo });
        expiredByVenue.set(venueKey, list);
        if (!dryRun) {
          await prisma.staffInvite.update({ where: { id: invite.id }, data: { managerAlertAt: now } });
        }
      }
    }

    const digests: Array<{ venue: string; to: string; expiring: number; expired: number; delivery: string }> = [];
    const venues = new Set([...expiringByVenue.keys(), ...expiredByVenue.keys()]);
    for (const venue of venues) {
      const expiring = expiringByVenue.get(venue) ?? [];
      const expired = expiredByVenue.get(venue) ?? [];
      const to = await managerRecipient(venue || null);
      if (!to) {
        digests.push({ venue: venue || 'unassigned', to: '(no recipient)', expiring: expiring.length, expired: expired.length, delivery: 'skipped' });
        continue;
      }
      if (dryRun) {
        digests.push({ venue: venue || 'unassigned', to, expiring: expiring.length, expired: expired.length, delivery: 'dry-run' });
        continue;
      }
      const delivery = await mailService.sendOnboardingChaseDigest({ to, expiring, expired });
      digests.push({ venue: venue || 'unassigned', to, expiring: expiring.length, expired: expired.length, delivery: delivery.status });
    }

    return {
      dryRun,
      reminderDays: [...INVITE_REMINDER_DAYS],
      outstanding: outstanding.length,
      skipped,
      reminders,
      digests
    };
  }
};
