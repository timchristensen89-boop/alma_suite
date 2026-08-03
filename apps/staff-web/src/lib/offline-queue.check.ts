/**
 * Exercises the offline queue against a stubbed sender and localStorage.
 *
 *   cd apps/staff-web && npx tsx src/lib/offline-queue.check.ts
 *
 * Kept in-tree because this queue holds someone's clock-on, and its failure
 * modes — a replayed press recording the wrong time, one bad request jamming
 * everything behind it, two flushes double-sending — are not obvious from
 * reading it.
 */
import { createOfflineQueue, OFFLINE_QUEUE_KEY } from './offline-queue';

const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  }
};

class NetworkDown extends Error {}
let sendImpl: (path: string) => Promise<unknown> = async () => {
  throw new NetworkDown('offline');
};
const queue = createOfflineQueue({
  send: (path) => sendImpl(path),
  isOffline: (error) => error instanceof NetworkDown
});

const offline = () => {
  sendImpl = async () => {
    throw new NetworkDown('offline');
  };
};
const online = (handler: (path: string) => unknown) => {
  sendImpl = async (path) => handler(path);
};

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failures += 1;
};

async function main() {
  store.clear();
  offline();
  const pressedAt = new Date().toISOString();
  const queued = await queue.enqueue('/api/staff/me/clock/in', { body: JSON.stringify({ occurredAt: pressedAt }) });
  check('an offline press is queued, not lost', queued.sent === false && queue.count() === 1, queued);
  check(
    'the moment the button was pressed survives',
    JSON.parse(JSON.parse(store.get(OFFLINE_QUEUE_KEY)!)[0].body).occurredAt === pressedAt
  );

  const stillOffline = await queue.flush();
  check('flushing while offline leaves it queued', stillOffline.sent === 0 && queue.count() === 1, stillOffline);

  await queue.enqueue('/api/staff/me/clock/out', { body: '{}' });
  const seen: string[] = [];
  online((path) => {
    seen.push(path);
    return undefined;
  });
  const drained = await queue.flush();
  check('reconnect sends everything', drained.sent === 2 && queue.count() === 0, drained);
  check('oldest first', seen[0] === '/api/staff/me/clock/in' && seen[1] === '/api/staff/me/clock/out', seen);

  store.clear();
  offline();
  await queue.enqueue('/api/rejected', { body: '{}' });
  await queue.enqueue('/api/fine', { body: '{}' });
  let call = 0;
  online(() => {
    call += 1;
    if (call === 1) throw new Error('You already have an open clock session.');
    return undefined;
  });
  const mixed = await queue.flush();
  check('a rejected request is dropped, not retried forever', mixed.dropped === 1 && mixed.sent === 1, mixed);
  check('one bad request does not jam the queue', queue.count() === 0);

  store.clear();
  offline();
  await queue.enqueue('/api/once', { body: '{}' });
  let sends = 0;
  online(() => {
    sends += 1;
    return undefined;
  });
  const [first, second] = await Promise.all([queue.flush(), queue.flush()]);
  check('two concurrent flushes send once', sends === 1, { sends });
  check('and both callers see the real result', JSON.stringify(first) === JSON.stringify(second) && first.sent === 1, {
    first,
    second
  });

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

void main();
