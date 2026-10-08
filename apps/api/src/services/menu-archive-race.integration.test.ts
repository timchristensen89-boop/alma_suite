/**
 * Menu Editor — archiving racing writes, against a real Postgres.
 *
 * Opt-in like menu.integration.test.ts: runs only when ALMA_TEST_DATABASE_URL
 * points at a Postgres with the migration history applied. The publish and
 * restore cases need headless Chrome; set ALMA_TEST_REQUIRE_CHROME=1 to make
 * a missing Chrome fail the run instead of skipping those cases.
 *
 *   ALMA_TEST_DATABASE_URL=postgresql://alma:alma@127.0.0.1:5432/alma_suite_test \
 *     node --import tsx --test src/services/menu-archive-race.integration.test.ts
 *
 * The race: every write checks that the menu is live and then writes. An
 * archive that commits in between must still win — the write is refused and
 * the archived menu's draft, name and published version are left exactly as
 * they were. Each case reproduces that window deterministically: an archive
 * transaction locks the menu row and flips it to ARCHIVED but does not commit;
 * the real service call runs, and its own check reads ACTIVE (the archive is
 * not visible yet); the archive commits only once that call is either
 * finished or waiting on the archive's lock.
 *
 * Rows hang off venues whose slug starts with "race-itest-" (not "itest-", so
 * the other integration file's cleanup never touches them, nor this one its).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { MENU_DOCUMENT_DEFAULTS, type MenuDocument } from '@alma/shared';

const TEST_DB = process.env.ALMA_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
const REQUIRE_CHROME = process.env.ALMA_TEST_REQUIRE_CHROME === '1';

type Harness = {
  prisma: typeof import('@alma/db').prisma;
  menus: typeof import('./menu.service.js').menuService;
  chromeOk: boolean;
  closeBrowser: () => Promise<void>;
  HttpError: typeof import('../lib/http.js').HttpError;
};

let h: Harness;
let venueId = '';
const chef = { id: 'race-chef', firstName: 'Race', lastName: 'Chef', email: 'race-chef@almagroup.com.au', roleTitle: 'Head Chef', venue: 'RACE', accountType: 'HUMAN', isAdmin: false, trainingOnly: false, role: 'STAFF', appAccess: [] } as unknown as import('@alma/shared').AuthUser;

const DOC: MenuDocument = {
  ...MENU_DOCUMENT_DEFAULTS,
  heading: 'Race night',
  dietaryNote: 'Dietaries catered with notice.',
  surchargeLine: 'A surcharge of 10% applies on weekends.',
  sections: [
    {
      title: 'To start',
      headerSuffix: null,
      subheading: null,
      sectionType: 'STANDARD',
      placement: 'LEFT',
      page: 1,
      lead: null,
      body: null,
      priceColumns: [],
      visible: true,
      items: [
        { dishKey: 'race-guac', name: 'Guacamole', description: 'Tostadas', priceCents: 1700, priceUnit: null, prices: [], meta: null, note: null, flags: [], tags: ['VG', 'GFA'], isSeafood: false, visible: true, recipeId: null },
        { dishKey: 'race-prawn', name: 'Prawn tostada', description: 'Avocado', priceCents: 2300, priceUnit: null, prices: [], meta: null, note: null, flags: [], tags: ['GFA', 'I'], isSeafood: true, visible: true, recipeId: null }
      ]
    }
  ]
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function wipe() {
  const venues = await h.prisma.venue.findMany({ where: { slug: { startsWith: 'race-itest-' } }, select: { id: true } });
  const ids = venues.map((venue) => venue.id);
  await h.prisma.menuAuditEvent.deleteMany({ where: { menu: { venueId: { in: ids } } } });
  await h.prisma.menu.deleteMany({ where: { venueId: { in: ids } } });
  await h.prisma.venue.deleteMany({ where: { id: { in: ids } } });
}

let menuSeq = 0;
async function newMenu(withDraft: boolean): Promise<string> {
  menuSeq += 1;
  const menu = await h.prisma.menu.create({ data: { venueId, name: `RACE ${menuSeq}`, slug: `race-${menuSeq}`, templateKey: 'freshwater_alacarte' } });
  if (withDraft) {
    await h.menus.createDraft(menu.id, chef);
    await h.menus.saveDraft(menu.id, DOC, chef);
  }
  return menu.id;
}

/** Everything the archive promises to keep: the menu's name and status, and every version with its rows and PDF. */
async function frozenState(menuId: string) {
  const menu = await h.prisma.menu.findUniqueOrThrow({ where: { id: menuId }, select: { name: true, status: true, versionCounter: true } });
  const versions = await h.prisma.menuVersion.findMany({
    where: { menuId },
    orderBy: { versionNumber: 'asc' },
    select: {
      id: true,
      versionNumber: true,
      state: true,
      heading: true,
      dietaryNote: true,
      updatedAt: true,
      pdfByteSize: true,
      publishedAt: true,
      sections: { orderBy: { sortOrder: 'asc' }, select: { title: true, items: { orderBy: { sortOrder: 'asc' }, select: { dishKey: true, name: true, priceCents: true } } } }
    }
  });
  return { name: menu.name, versionCounter: menu.versionCounter, versions: JSON.parse(JSON.stringify(versions)) as unknown };
}

async function backendPid(tx: Pick<typeof h.prisma, '$queryRaw'>): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
  return rows[0]!.pid;
}

/** Sessions currently waiting on a lock that `pid` holds. */
async function blockedBy(pid: number): Promise<number> {
  const rows = await h.prisma.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`;
  return rows[0]?.n ?? 0;
}

/**
 * Archive `menuId` while `write` runs: lock the row and flip it to ARCHIVED in
 * an open transaction, start the write, and commit only once the write has
 * finished or is waiting on this transaction's lock. The write's own "is it
 * live?" check therefore always runs before the archive is visible, and
 * whatever it writes afterwards happens after the archive committed.
 */
async function archiveDuring<T>(menuId: string, write: () => Promise<T>): Promise<{ outcome: PromiseSettledResult<T>; writeWaitedOnArchive: boolean }> {
  const state: { outcome: PromiseSettledResult<T> | null; waited: boolean } = { outcome: null, waited: false };
  let running: Promise<void> = Promise.resolve();
  await h.prisma.$transaction(
    async (tx) => {
      const pid = await backendPid(tx);
      await tx.$queryRaw`SELECT "id" FROM "Menu" WHERE "id" = ${menuId} FOR UPDATE`;
      await tx.menu.update({ where: { id: menuId }, data: { status: 'ARCHIVED' } });
      running = write().then(
        (value) => void (state.outcome = { status: 'fulfilled', value }),
        (reason: unknown) => void (state.outcome = { status: 'rejected', reason })
      );
      const deadline = Date.now() + 25_000;
      while (!state.outcome) {
        if ((await blockedBy(pid)) > 0) {
          state.waited = true;
          break;
        }
        if (Date.now() > deadline) throw new Error('the write neither finished nor waited on the archive lock');
        await sleep(15);
      }
    },
    { timeout: 40_000, maxWait: 10_000 }
  );
  await running;
  return { outcome: state.outcome!, writeWaitedOnArchive: state.waited };
}

function assertArchivedRefusal(outcome: PromiseSettledResult<unknown>, menuId: string, writeWaitedOnArchive: boolean) {
  assert.equal(outcome.status, 'rejected', 'the write went through after the archive committed');
  // It can only have seen ARCHIVED by queueing on the archive's row lock: the
  // archive was not committed when the write's own pre-check ran.
  assert.equal(writeWaitedOnArchive, true, 'the write should have waited on the menu row lock');
  const error = (outcome as PromiseRejectedResult).reason;
  assert.ok(error instanceof h.HttpError, `expected an HttpError, got ${String(error)}`);
  assert.equal(error.statusCode, 409);
  assert.deepEqual(error.details, { code: 'MENU_ARCHIVED', menuId });
}

async function unarchive(menuId: string) {
  await h.prisma.menu.update({ where: { id: menuId }, data: { status: 'ACTIVE' } });
}

describe('archiving racing writes (Postgres)', { skip: TEST_DB ? false : 'skipped: set ALMA_TEST_DATABASE_URL to run' }, () => {
  before(async () => {
    const [{ prisma }, { menuService }, pdf, http] = await Promise.all([import('@alma/db'), import('./menu.service.js'), import('../lib/menu-pdf.js'), import('../lib/http.js')]);
    h = { prisma, menus: menuService, chromeOk: pdf.chromeStatus().ok, closeBrowser: pdf.closeMenuBrowser, HttpError: http.HttpError };
    if (REQUIRE_CHROME && !h.chromeOk) throw new Error(`ALMA_TEST_REQUIRE_CHROME=1 but Chrome is not available: ${pdf.chromeStatus().message}`);
    await wipe();
    venueId = (await h.prisma.venue.create({ data: { name: 'RACE Venue', slug: 'race-itest-venue' } })).id;
  });

  after(async () => {
    if (h) {
      await wipe();
      await h.closeBrowser();
      await h.prisma.$disconnect();
    }
  });

  const requiresChrome = (t: { skip: (message: string) => void }) => {
    if (h.chromeOk) return false;
    t.skip('headless Chrome not available');
    return true;
  };

  it('a save that loses the race to an archive is refused; the archived draft is untouched', async () => {
    const menuId = await newMenu(true);
    const draft = await h.menus.getDraft(menuId);
    const before = await frozenState(menuId);
    const changed = { ...draft.document, heading: 'Saved after archive', expectedUpdatedAt: draft.version.updatedAt };
    const { outcome, writeWaitedOnArchive } = await archiveDuring(menuId, () => h.menus.saveDraft(menuId, changed, chef));
    assertArchivedRefusal(outcome, menuId, writeWaitedOnArchive);
    assert.deepEqual(await frozenState(menuId), before);
    await unarchive(menuId);
  });

  it('a discard that loses the race is refused; the kept draft survives', async () => {
    const menuId = await newMenu(true);
    const before = await frozenState(menuId);
    const { outcome, writeWaitedOnArchive } = await archiveDuring(menuId, () => h.menus.discardDraft(menuId, chef));
    assertArchivedRefusal(outcome, menuId, writeWaitedOnArchive);
    assert.deepEqual(await frozenState(menuId), before);
    await unarchive(menuId);
  });

  it('a rename that loses the race is refused; the archived name stays', async () => {
    const menuId = await newMenu(true);
    const before = await frozenState(menuId);
    const { outcome, writeWaitedOnArchive } = await archiveDuring(menuId, () => h.menus.updateMenu(menuId, { name: 'Renamed after archive' }, chef));
    assertArchivedRefusal(outcome, menuId, writeWaitedOnArchive);
    assert.deepEqual(await frozenState(menuId), before);
    await unarchive(menuId);
  });

  it('starting a draft that loses the race is refused; no version number is spent', async () => {
    const menuId = await newMenu(false);
    const before = await frozenState(menuId);
    const { outcome, writeWaitedOnArchive } = await archiveDuring(menuId, () => h.menus.createDraft(menuId, chef));
    assertArchivedRefusal(outcome, menuId, writeWaitedOnArchive);
    assert.deepEqual(await frozenState(menuId), before);
    await unarchive(menuId);
  });

  it('copying a dish into a menu being archived is refused, naming the target', async () => {
    const source = await newMenu(true);
    const target = await newMenu(true);
    const before = await frozenState(target);
    const { outcome, writeWaitedOnArchive } = await archiveDuring(target, () => h.menus.copyItemTo(source, { dishKey: 'race-guac', targetMenuId: target }, chef));
    assertArchivedRefusal(outcome, target, writeWaitedOnArchive);
    assert.deepEqual(await frozenState(target), before);
    await unarchive(target);
  });

  it('copying a dish out of a menu being archived is refused, naming the source', async () => {
    const source = await newMenu(true);
    const target = await newMenu(true);
    const before = { source: await frozenState(source), target: await frozenState(target) };
    const { outcome, writeWaitedOnArchive } = await archiveDuring(source, () => h.menus.copyItemTo(source, { dishKey: 'race-guac', targetMenuId: target }, chef));
    assertArchivedRefusal(outcome, source, writeWaitedOnArchive);
    assert.deepEqual({ source: await frozenState(source), target: await frozenState(target) }, before);
    await unarchive(source);
  });

  it('copies in opposite directions between two menus queue in one lock order and never deadlock', async () => {
    const a = await newMenu(true);
    const b = await newMenu(true);
    const runs = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        index % 2 === 0
          ? h.menus.copyItemTo(a, { dishKey: 'race-guac', targetMenuId: b }, chef)
          : h.menus.copyItemTo(b, { dishKey: 'race-prawn', targetMenuId: a }, chef)
      )
    );
    const failures = runs.filter((run): run is PromiseRejectedResult => run.status === 'rejected').map((run) => String(run.reason));
    assert.deepEqual(failures, []);
    const count = async (menuId: string) => h.prisma.menuItem.count({ where: { section: { version: { menuId, state: 'DRAFT' } } } });
    assert.equal(await count(a), 2 + 3);
    assert.equal(await count(b), 2 + 3);
  });

  it('archive waits for a write already holding the menu lock, then applies', async () => {
    const menuId = await newMenu(true);
    const state: { archived: boolean; waited: boolean } = { archived: false, waited: false };
    let archiving: Promise<unknown> = Promise.resolve();
    await h.prisma.$transaction(
      async (tx) => {
        const pid = await backendPid(tx);
        await tx.$queryRaw`SELECT "id" FROM "Menu" WHERE "id" = ${menuId} FOR UPDATE`;
        archiving = h.menus.archiveMenu(menuId, chef).then(() => void (state.archived = true));
        const deadline = Date.now() + 15_000;
        while (!state.archived && (await blockedBy(pid)) === 0) {
          if (Date.now() > deadline) throw new Error('archive neither finished nor waited');
          await sleep(15);
        }
        state.waited = !state.archived;
      },
      { timeout: 30_000, maxWait: 10_000 }
    );
    await archiving;
    assert.equal(state.waited, true, 'archive did not wait for the menu row lock');
    assert.equal((await h.prisma.menu.findUniqueOrThrow({ where: { id: menuId } })).status, 'ARCHIVED');
    await unarchive(menuId);
  });

  it('a restore that loses the race is refused; versions are untouched', async (t) => {
    if (requiresChrome(t)) return;
    const menuId = await newMenu(true);
    const v1 = await h.menus.publish(menuId, { acknowledgeWarnings: true }, chef);
    const before = await frozenState(menuId);
    const { outcome, writeWaitedOnArchive } = await archiveDuring(menuId, () => h.menus.restore(v1.version.id, {}, chef));
    assertArchivedRefusal(outcome, menuId, writeWaitedOnArchive);
    assert.deepEqual(await frozenState(menuId), before);
    await unarchive(menuId);
  });

  it('a publish that loses the race — archive lands while the PDF renders — is refused; the live version stays live', async (t) => {
    if (requiresChrome(t)) return;
    const menuId = await newMenu(true);
    const v1 = await h.menus.publish(menuId, { acknowledgeWarnings: true }, chef);
    await h.menus.createDraft(menuId, chef);
    const draft = await h.menus.getDraft(menuId);
    await h.menus.saveDraft(menuId, { ...draft.document, heading: 'Never printed' }, chef);
    const before = await frozenState(menuId);
    const { outcome, writeWaitedOnArchive } = await archiveDuring(menuId, () => h.menus.publish(menuId, { acknowledgeWarnings: true }, chef));
    assertArchivedRefusal(outcome, menuId, writeWaitedOnArchive);
    const afterState = await frozenState(menuId);
    assert.deepEqual(afterState, before);
    const live = await h.prisma.menuVersion.findMany({ where: { menuId, state: 'PUBLISHED' }, select: { id: true } });
    assert.deepEqual(live.map((row) => row.id), [v1.version.id]);
    await unarchive(menuId);
  });
});
