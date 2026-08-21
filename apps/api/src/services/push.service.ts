import webpush from 'web-push';
import { prisma } from '@alma/db';
import { HttpError } from '../lib/http.js';
import { env } from '../env.js';

/**
 * Web push to staff phones.
 *
 * Deliberately best-effort. Everything here is a second way of telling someone
 * something they were already emailed and can already see in the app, so no
 * failure in this file is ever allowed to fail the thing that triggered it —
 * publishing a roster must not roll back because a phone is out of battery.
 */

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

let configured = false;

/**
 * VAPID keys are read once and cached, because setVapidDetails validates the
 * pair and throws on a malformed key — we want that to happen on the first
 * send and be caught, not on every send.
 */
function ensureConfigured(): boolean {
  if (configured) return true;
  const { publicKey, privateKey, subject } = env.webPush;
  if (!publicKey || !privateKey) return false;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
    return true;
  } catch (error) {
    console.error('[push] VAPID keys are set but not usable:', error instanceof Error ? error.message : error);
    return false;
  }
}

export function isPushConfigured(): boolean {
  return Boolean(env.webPush.publicKey && env.webPush.privateKey);
}

/**
 * A push service telling us this endpoint is gone for good.
 *
 * 404 and 410 are the two the spec defines for "this subscription no longer
 * exists" — the app was uninstalled, the browser data cleared, the push
 * registration expired. Anything else (429, 500, a timeout) is transient and
 * the row stays.
 */
function isGone(error: unknown): boolean {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return status === 404 || status === 410;
}

export const pushService = {
  /**
   * The browser needs the VAPID public key before it can subscribe.
   *
   * Served rather than baked into the bundle so rotating the pair is an env
   * change and a restart, not a frontend rebuild and redeploy.
   */
  config(): { configured: boolean; publicKey: string } {
    return { configured: isPushConfigured(), publicKey: env.webPush.publicKey };
  },

  /**
   * Record a device. Upsert by endpoint, and let the owner change.
   *
   * A venue phone gets handed on. If the next person subscribes on it, the
   * endpoint is the same and the row must follow them — otherwise the previous
   * holder keeps getting somebody else's shifts on a phone they no longer have.
   */
  async subscribe(
    staffProfileId: string,
    subscription: PushSubscriptionInput,
    userAgent?: string | null
  ): Promise<{ endpoint: string }> {
    const endpoint = String(subscription?.endpoint ?? '').trim();
    const p256dh = String(subscription?.keys?.p256dh ?? '').trim();
    const auth = String(subscription?.keys?.auth ?? '').trim();

    if (!endpoint || !p256dh || !auth) {
      throw new HttpError(400, 'That subscription is missing its endpoint or keys.');
    }
    if (!/^https:\/\//i.test(endpoint)) {
      // Push services are always https. Anything else is a bug or a probe.
      throw new HttpError(400, 'A push endpoint must be an https URL.');
    }

    await prisma.staffPushSubscription.upsert({
      where: { endpoint },
      create: {
        staffProfileId,
        endpoint,
        p256dh,
        auth,
        userAgent: userAgent?.slice(0, 400) ?? null
      },
      update: {
        staffProfileId,
        p256dh,
        auth,
        userAgent: userAgent?.slice(0, 400) ?? null,
        // A fresh subscribe is a working device saying so. Whatever went wrong
        // before is history.
        failureCount: 0
      }
    });

    return { endpoint };
  },

  /**
   * Turn it off for one device.
   *
   * Scoped to the caller so one person cannot unsubscribe another's phone by
   * guessing an endpoint. Silent when there is nothing to remove: "off" is the
   * state the caller asked for, and they are now in it.
   */
  async unsubscribe(staffProfileId: string, endpoint: string): Promise<{ removed: number }> {
    const clean = String(endpoint ?? '').trim();
    if (!clean) throw new HttpError(400, 'Which device? No endpoint was sent.');
    const { count } = await prisma.staffPushSubscription.deleteMany({
      where: { endpoint: clean, staffProfileId }
    });
    return { removed: count };
  },

  /** How many devices this person currently has switched on. */
  async deviceCount(staffProfileId: string): Promise<number> {
    return prisma.staffPushSubscription.count({ where: { staffProfileId } });
  },

  /**
   * Push one notification to every device a person has registered.
   *
   * Returns what happened rather than throwing: the caller is normally
   * mid-publish and wants a count for the manager, not an exception.
   */
  async sendToStaff(
    staffProfileId: string,
    notification: { title: string; body: string; url?: string; tag?: string }
  ): Promise<{ sent: number; failed: number; pruned: number }> {
    if (!ensureConfigured()) return { sent: 0, failed: 0, pruned: 0 };

    const devices = await prisma.staffPushSubscription.findMany({
      where: { staffProfileId },
      select: { id: true, endpoint: true, p256dh: true, auth: true }
    });
    if (devices.length === 0) return { sent: 0, failed: 0, pruned: 0 };

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      url: notification.url ?? '/roster',
      // Same tag replaces an earlier unread one rather than stacking. Two
      // "your roster is up" notifications on a lock screen is noise, and the
      // later one is the true one.
      tag: notification.tag ?? 'alma-roster'
    });

    let sent = 0;
    let failed = 0;
    let pruned = 0;

    await Promise.all(
      devices.map(async (device) => {
        try {
          await webpush.sendNotification(
            { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
            payload,
            { TTL: 12 * 60 * 60 }
          );
          sent += 1;
          await prisma.staffPushSubscription.update({
            where: { id: device.id },
            data: { lastSuccessAt: new Date(), failureCount: 0 }
          });
        } catch (error) {
          if (isGone(error)) {
            pruned += 1;
            await prisma.staffPushSubscription
              .delete({ where: { id: device.id } })
              .catch(() => undefined);
            return;
          }
          failed += 1;
          const reason = error instanceof Error ? error.message : String(error);
          console.error(`[push] send failed for ${device.endpoint.slice(0, 60)}…: ${reason}`);
          await prisma.staffPushSubscription
            .update({ where: { id: device.id }, data: { failureCount: { increment: 1 } } })
            .catch(() => undefined);
        }
      })
    );

    return { sent, failed, pruned };
  }
};
