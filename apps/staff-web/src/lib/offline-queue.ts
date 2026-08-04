/**
 * Mutations that must survive the venue's wifi.
 *
 * Clocking on happens in a doorway, on a phone, in a building with one bar of
 * signal. Losing that press means someone is unpaid for the first hour of
 * their shift and has to ask a manager to fix it — exactly the friction this
 * app exists to remove.
 *
 * A queued request keeps the moment the button was pressed and replays it when
 * the connection returns. The server clamps that time, so a queue sitting
 * overnight cannot write a shift into yesterday.
 *
 * The sender is injected rather than imported so this file has no dependency
 * on the Vite-specific api module, and can be exercised under plain Node.
 */

export type QueuedRequest = {
  id: string;
  path: string;
  method: string;
  body: string | null;
  queuedAt: string;
};

export const OFFLINE_QUEUE_KEY = 'alma.staff.offlineQueue';

export type Sender = (path: string, init: { method: string; body?: string }) => Promise<unknown>;
/** True only for a network-level failure — a 400 would fail again identically. */
export type IsOffline = (error: unknown) => boolean;

export function createOfflineQueue(options: { send: Sender; isOffline: IsOffline; storageKey?: string }) {
  const key = options.storageKey ?? OFFLINE_QUEUE_KEY;

  const read = (): QueuedRequest[] => {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? (parsed as QueuedRequest[]) : [];
    } catch {
      return [];
    }
  };

  const write = (items: QueuedRequest[]) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(items));
    } catch {
      // A full or disabled localStorage is survivable — the request simply
      // fails the way it did before there was a queue.
    }
  };

  const count = () => read().length;

  /**
   * Send now, or keep it and send when the connection comes back.
   *
   * Reports whether it went straight out, so the caller can say "clocked on"
   * or "saved, it'll send when you're back" rather than claiming success.
   */
  const enqueue = async (path: string, init: { method?: string; body?: string } = {}) => {
    const method = init.method ?? 'POST';
    const body = typeof init.body === 'string' ? init.body : null;
    try {
      await options.send(path, { method, body: body ?? undefined });
      return { sent: true };
    } catch (error) {
      if (!options.isOffline(error)) throw error;
      write([
        ...read(),
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          path,
          method,
          body,
          queuedAt: new Date().toISOString()
        }
      ]);
      return { sent: false };
    }
  };

  let inFlight: Promise<{ sent: number; dropped: number }> | null = null;

  const drain = async () => {
    let sent = 0;
    let dropped = 0;
    let queue = read();
    while (queue.length > 0) {
      const next = queue[0]!;
      try {
        await options.send(next.path, { method: next.method, body: next.body ?? undefined });
        sent += 1;
      } catch (error) {
        // Still no connection: stop, and leave the queue exactly as it is.
        if (options.isOffline(error)) break;
        // A real rejection — already clocked in, session expired — would fail
        // identically forever and block everything behind it.
        dropped += 1;
        console.warn('[offline] dropping a request the server rejected', {
          path: next.path,
          reason: error instanceof Error ? error.message : 'unknown'
        });
      }
      queue = queue.slice(1);
      write(queue);
    }
    return { sent, dropped };
  };

  /**
   * Replay queued requests, oldest first.
   *
   * Concurrent callers join the run already going rather than getting a fake
   * empty result — reporting {sent:0} mid-flight is indistinguishable from
   * "nothing to send", which makes a "Try now" button look broken at the exact
   * moment it is working.
   */
  const flush = (): Promise<{ sent: number; dropped: number }> => {
    if (inFlight) return inFlight;
    inFlight = drain().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return { enqueue, flush, count };
}
