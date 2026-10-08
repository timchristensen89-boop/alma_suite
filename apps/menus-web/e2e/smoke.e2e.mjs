/**
 * The whole menu-management flow once, end to end: the home as a publisher,
 * New menu (focus, defaults, copy of the live menu), the printed heading in
 * the editor and the A4 preview, autosave, a first publish, a heading-only
 * change in the publish diff, the case-insensitive name check, rename,
 * archive (read-only editor and History), unarchive, the home on a phone, and
 * the home as a draft-only chef. Counts are taken relative to what the
 * database held before, so it runs beside the other suites and on reruns.
 * See helpers.mjs for how to run.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  E2E,
  api,
  cardNames,
  clickByText,
  headingInput,
  launch,
  replaceValue,
  screenshot,
  serverHeading,
  session,
  skipReason,
  sleep,
  text,
  venueSection,
  waitForText
} from './helpers.mjs';

const VENUE = 'St Alma';
const OTHER_VENUE = 'Alma Avalon';

describe('menu management, end to end', { skip: skipReason }, () => {
  let browser;
  let admin;
  const name = `E2E Smoke ${Date.now().toString(36)}`;
  const renamed = `${name} renamed`;
  let menuId = '';
  let cardsBefore = 0;

  before(async () => {
    browser = await launch();
    admin = await session(browser, E2E.adminEmail);
  });

  after(async () => {
    // Leave the home as it was: the smoke menu ends archived.
    if (admin && menuId) await api(admin.page, 'POST', `/api/menus/${menuId}/archive`).catch(() => undefined);
    await browser?.close();
  });

  const previewTitle = (page) => page.evaluate(() => document.querySelector('iframe')?.contentDocument?.querySelector('.title')?.textContent ?? null);

  it('the home groups menus by venue and gives a publisher New menu, Rename and Archive', async () => {
    const page = admin.page;
    await venueSection(page, VENUE);
    await venueSection(page, OTHER_VENUE);
    const body = await text(page);
    assert.ok(body.includes('Headed “À la carte”'), 'cards show what each page is headed');
    assert.ok((await page.$$('.menus-venue-add')).length >= 2, 'a New menu button per venue with a template');
    assert.ok((await page.$$('.menu-card-manage')).length >= 2, 'Rename and Archive on the cards');
    cardsBefore = (await cardNames(page, VENUE)).length;
    await screenshot(page, '01-home-admin');
  });

  it('New menu focuses the name, preselects the venue and offers a copy of its live menu; Create opens the editor', async () => {
    const page = admin.page;
    await (await (await venueSection(page, VENUE)).$('.menus-venue-add')).click();
    await page.waitForSelector('dialog[open]');
    await sleep(300);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'new-menu-name');
    assert.equal(await page.$eval('#new-menu-venue', (select) => select.selectedOptions[0].textContent), VENUE);
    const source = await page.$eval('#new-menu-source', (select) => select.selectedOptions[0].textContent);
    assert.ok(source.startsWith(`Copy of ${VENUE} · `) && source.includes('(live v'), source);
    await page.type('#new-menu-name', name);
    await page.type('#new-menu-heading', 'Taco Tuesday');
    await screenshot(page, '02-new-menu-dialog');
    await clickByText(page, 'dialog[open] button', 'Create and open');
    await page.waitForFunction(() => location.pathname.endsWith('/edit'), { timeout: 15_000 });
    await page.waitForSelector('.editor-form', { timeout: 15_000 });
    menuId = await page.evaluate(() => location.pathname.split('/')[2]);
    const body = await text(page);
    assert.ok(body.includes(name) && body.includes('Draft v1'));
    assert.equal(await (await headingInput(page)).evaluate((input) => input.value), 'Taco Tuesday');
    await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('.title')?.textContent === 'Taco Tuesday', { timeout: 15_000 });
    await screenshot(page, '03-editor-heading');
  });

  it('a heading edit autosaves and the A4 preview follows it', async () => {
    const page = admin.page;
    await replaceValue(page, await headingInput(page), 'Tuesdays at St Alma');
    for (let waited = 0; (await serverHeading(page, menuId)) !== 'Tuesdays at St Alma'; waited += 250) {
      if (waited > 15_000) throw new Error('the heading never reached the server');
      await sleep(250);
    }
    await waitForText(page, 'Saved today');
    assert.equal(await previewTitle(page), 'Tuesdays at St Alma');
  });

  it('the first publish has no errors and produces v1', async () => {
    const page = admin.page;
    await clickByText(page, 'button', 'Publish…');
    await page.waitForSelector('dialog[open] .menu-dialog-status', { timeout: 30_000 });
    const body = await text(page);
    assert.ok(body.includes('first published version') && body.includes('No errors'));
    await screenshot(page, '04-publish-first');
    await clickByText(page, 'dialog[open] button', 'Publish');
    await waitForText(page, 'Published v1', 30_000);
  });

  it('a heading-only change shows as a Heading row and "heading changed" in the publish dialog', async () => {
    const page = admin.page;
    await clickByText(page, 'button', 'Start another draft');
    await page.waitForSelector('.editor-form', { timeout: 15_000 });
    await replaceValue(page, await headingInput(page), 'Taco Tuesday');
    for (let waited = 0; (await serverHeading(page, menuId)) !== 'Taco Tuesday'; waited += 250) {
      if (waited > 15_000) throw new Error('the heading never reached the server');
      await sleep(250);
    }
    await clickByText(page, 'button', 'Publish…');
    await page.waitForSelector('dialog[open] .menu-dialog-status', { timeout: 30_000 });
    assert.equal(await page.$eval('dialog[open] .diff-view .diff-group li', (row) => row.textContent), 'Tuesdays at St Alma → Taco Tuesday');
    assert.equal(await page.$eval('dialog[open] .menu-dialog-summary', (line) => line.textContent), 'heading changed');
    await screenshot(page, '05-publish-heading-diff');
    await clickByText(page, 'dialog[open] button', 'Back to editing');
  });

  it('back on the home the venue has one more card, showing its live heading', async () => {
    const page = admin.page;
    await page.goto(E2E.base, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.menus-venue');
    const names = await cardNames(page, VENUE);
    assert.equal(names.length, cardsBefore + 1);
    assert.ok(names.includes(name));
    assert.ok((await text(page)).includes('Headed “Tuesdays at St Alma”'));
  });

  it('a name that differs only in case is refused in the dialog; Cancel closes it', async () => {
    const page = admin.page;
    await (await (await venueSection(page, VENUE)).$('.menus-venue-add')).click();
    await page.waitForSelector('dialog[open]');
    await page.type('#new-menu-name', name.toLowerCase());
    await clickByText(page, 'dialog[open] button', 'Create and open');
    await page.waitForSelector('dialog[open] .error-text', { timeout: 10_000 });
    assert.equal(await page.$eval('dialog[open] .error-text', (error) => error.textContent), `This venue already has a menu called "${name}". Pick another name.`);
    await clickByText(page, 'dialog[open] button', 'Cancel');
    await sleep(300);
    assert.equal(await page.$('dialog[open]'), null);
  });

  it('Rename focuses its field and Enter submits it', async () => {
    const page = admin.page;
    await clickByText(page, 'button', `Rename ${VENUE} · ${name}`);
    await page.waitForSelector('dialog[open] #rename-menu-name');
    await sleep(200);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'rename-menu-name');
    await replaceValue(page, await page.$('#rename-menu-name'), renamed);
    await page.keyboard.press('Enter');
    await waitForText(page, `Renamed to ${VENUE} · ${renamed}`, 10_000);
    await page.waitForSelector(`button[aria-label="Archive ${VENUE} · ${renamed}"]`, { timeout: 10_000 });
  });

  it('Archive takes it off the grid into the archived list, with its draft kept', async () => {
    const page = admin.page;
    await clickByText(page, 'button', `Archive ${VENUE} · ${renamed}`);
    await page.waitForSelector('dialog[open]');
    await screenshot(page, '06-archive-dialog');
    await clickByText(page, 'dialog[open] button', 'Archive menu');
    await waitForText(page, `${VENUE} · ${renamed} archived`, 10_000);
    await page.waitForFunction((label) => [...document.querySelectorAll('.archived-row strong')].some((row) => row.textContent === label), { timeout: 10_000 }, `${VENUE} · ${renamed}`);
    assert.ok(!(await cardNames(page, VENUE)).includes(renamed), 'not on the grid any more');
    const row = await page.evaluate((label) => [...document.querySelectorAll('.archived-row')].find((element) => element.querySelector('strong')?.textContent === label)?.textContent ?? '', `${VENUE} · ${renamed}`);
    assert.ok(row.includes('last live v1') && row.includes('draft v2 kept'), row);
    await screenshot(page, '07-home-archived');
  });

  it('an archived menu opens read-only in the editor, and History keeps its PDFs without restore or editor buttons', async () => {
    const page = admin.page;
    await page.goto(`${E2E.base}/menus/${menuId}/edit`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'This menu is archived');
    assert.ok(!(await text(page)).includes('Discard draft'));
    await page.goto(`${E2E.base}/menus/${menuId}/history`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'Kept with the archived menu');
    const body = await text(page);
    assert.ok(!body.includes('Open in editor') && !body.includes('Restore as new draft') && body.includes('View PDF'));
    await screenshot(page, '08-history-archived');
  });

  it('Unarchive puts it back on the grid', async () => {
    const page = admin.page;
    await page.goto(E2E.base, { waitUntil: 'networkidle0' });
    const label = `${VENUE} · ${renamed}`;
    await page.waitForFunction((value) => [...document.querySelectorAll('.archived-row strong')].some((row) => row.textContent === value), { timeout: 10_000 }, label);
    const unarchive = await page.evaluateHandle((value) => [...document.querySelectorAll('.archived-row')].find((row) => row.querySelector('strong')?.textContent === value)?.querySelector('button') ?? null, label);
    await unarchive.asElement().click();
    await waitForText(page, `${label} is back on the home`, 10_000);
    await page.waitForFunction((value) => [...document.querySelectorAll('.menu-card .card-title')].some((title) => title.textContent === value), { timeout: 10_000 }, renamed);
    assert.equal((await cardNames(page, VENUE)).length, cardsBefore + 1);
  });

  it('on a phone the home has no horizontal scroll', async () => {
    const phone = await session(browser, E2E.adminEmail, { width: 390, height: 844 });
    try {
      await screenshot(phone.page, '09-home-phone');
      assert.ok((await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
      assert.deepEqual(phone.errors, []);
    } finally {
      await phone.page.browserContext().close();
    }
  });

  it('a draft-only chef sees the venues without New menu, Rename or Archive, and the API refuses a new menu', async () => {
    const chef = await session(browser, E2E.chefEmail);
    try {
      const page = chef.page;
      await venueSection(page, VENUE);
      await venueSection(page, OTHER_VENUE);
      assert.equal((await page.$$('.menus-venue-add')).length, 0);
      assert.equal(await page.$('.menu-card-manage'), null);
      assert.ok((await text(page)).includes('a manager or the head chef publishes and manages the list of menus'));
      await screenshot(page, '10-home-chef');
      assert.equal((await api(page, 'POST', '/api/menus', { venueId: 'x', name: 'Sneaky' })).status, 403);
      assert.deepEqual(chef.errors, []);
    } finally {
      await chef.page.browserContext().close();
    }
  });

  it('no unexpected console or page errors', () => {
    assert.deepEqual(admin.errors, []);
  });
});
