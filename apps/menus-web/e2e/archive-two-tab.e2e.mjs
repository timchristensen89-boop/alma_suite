/**
 * A menu archived in one tab while another tab is editing it: the editing tab
 * stops saving, goes read-only and keeps what it had not saved; copying into
 * an archived menu leaves the source editable; publishing an archived menu is
 * refused. See helpers.mjs for how to run.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  E2E,
  api,
  appendValue,
  clickByText,
  headingInput,
  keptCopy,
  launch,
  newMenu,
  replaceValue,
  serverHeading,
  session,
  skipReason,
  sleep,
  text,
  waitForText
} from './helpers.mjs';

describe('archiving a menu that another tab is editing', { skip: skipReason }, () => {
  let browser;
  let admin;
  let chef;
  let menu;

  before(async () => {
    browser = await launch();
    admin = await session(browser, E2E.adminEmail);
    chef = await session(browser, E2E.chefEmail);
    menu = await newMenu(admin.page, 'Two tab');
  });

  after(async () => {
    await browser?.close();
  });

  it('the refused autosave turns the editing tab read-only, stops saving, and keeps the unsaved edit', async () => {
    const page = chef.page;
    let saves = 0;
    const countSaves = (request) => {
      if (request.method() === 'PUT' && request.url().endsWith(`/api/menus/${menu.id}/draft`)) saves += 1;
    };
    page.on('request', countSaves);
    try {
      await page.goto(`${E2E.base}/menus/${menu.id}/edit`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.editor-form');
      await replaceValue(page, await headingInput(page), 'Tab A typed this');
      await page.waitForFunction(() => /Saved today/.test(document.body.textContent), { timeout: 15_000 });
      await sleep(200);
      assert.equal(await serverHeading(admin.page, menu.id), 'Tab A typed this');
      const before = saves;

      assert.equal((await api(admin.page, 'POST', `/api/menus/${menu.id}/archive`)).status, 200);
      await appendValue(page, await headingInput(page), ' and more');
      await waitForText(page, 'This menu is archived');
      assert.equal(await page.$('.editor-form'), null, 'no editable form after the switch');
      const body = await text(page);
      assert.ok(body.includes('Your unsaved changes') && body.includes('kept in this browser'));
      assert.equal(await page.$eval('.unsaved-card .diff-group li', (element) => element.textContent), 'Tab A typed this → Tab A typed this and more');
      assert.equal(saves - before, 1, 'exactly one save after the archive: the refused one');
      const atSwitch = saves;
      await page.keyboard.type(' still typing');
      await sleep(3_000);
      assert.equal(saves, atSwitch, 'nothing more is sent');
      assert.equal(await serverHeading(admin.page, menu.id), 'Tab A typed this', 'the archived draft is unchanged');
      assert.equal(JSON.parse(await keptCopy(page, menu.id)).document.heading, 'Tab A typed this and more');
    } finally {
      page.off('request', countSaves);
    }
  });

  it('after unarchive the kept edit can be applied, and its copy goes once the draft has saved it', async () => {
    const page = chef.page;
    assert.equal((await api(admin.page, 'POST', `/api/menus/${menu.id}/unarchive`)).status, 200);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.editor-form');
    await clickByText(page, 'button', 'Apply to this draft');
    await page.waitForFunction(() => !document.body.textContent.includes('Unsaved changes from'), { timeout: 15_000 });
    assert.equal(await serverHeading(admin.page, menu.id), 'Tab A typed this and more');
    assert.equal(await keptCopy(page, menu.id), null);
  });

  it('copying into a menu archived meanwhile is refused for the target only; the source stays editable', async () => {
    const page = chef.page;
    const target = await newMenu(admin.page, 'Copy target');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.editor-form');
    const count = async (id) => (await api(admin.page, 'GET', `/api/menus/${id}/draft`)).json.document.sections.reduce((sum, section) => sum + section.items.length, 0);
    const before = await count(target.id);
    assert.equal((await api(admin.page, 'POST', `/api/menus/${target.id}/archive`)).status, 200);
    await clickByText(page, 'button', 'Copy to another menu');
    await page.waitForSelector('.menu-sheet');
    await clickByText(page, '.menu-sheet button', `St Alma · ${target.name}`);
    await waitForText(page, `St Alma · ${target.name} was archived, so "`);
    assert.notEqual(await page.$('.editor-form'), null, 'the source editor stays editable');
    assert.equal(await count(target.id), before, 'the archived target is unchanged');
    await clickByText(page, 'button', 'Copy to another menu');
    await page.waitForSelector('.menu-sheet');
    const offered = await page.evaluate((name) => [...document.querySelectorAll('.menu-sheet button')].some((element) => element.textContent.includes(name)), target.name);
    assert.equal(offered, false, 'the archived target is no longer offered');
    await clickByText(page, '.menu-sheet button', 'Cancel');
  });

  it('publishing a menu archived meanwhile is refused, with the dialog open or not, and nothing is published', async () => {
    const editor = await session(browser, E2E.adminEmail);
    try {
      await editor.page.goto(`${E2E.base}/menus/${menu.id}/edit`, { waitUntil: 'networkidle0' });
      await editor.page.waitForSelector('.editor-form');
      assert.equal((await api(admin.page, 'POST', `/api/menus/${menu.id}/archive`)).status, 200);
      await clickByText(editor.page, 'button', 'Publish…');
      await waitForText(editor.page, 'This menu is archived');
      assert.equal(await editor.page.$('dialog[open]'), null);

      assert.equal((await api(admin.page, 'POST', `/api/menus/${menu.id}/unarchive`)).status, 200);
      await editor.page.reload({ waitUntil: 'networkidle0' });
      await editor.page.waitForSelector('.editor-form');
      await clickByText(editor.page, 'button', 'Publish…');
      await editor.page.waitForSelector('dialog[open] .menu-dialog-status', { timeout: 30_000 });
      assert.equal((await api(admin.page, 'POST', `/api/menus/${menu.id}/archive`)).status, 200);
      await clickByText(editor.page, 'dialog[open] button', 'Publish');
      await waitForText(editor.page, 'This menu is archived', 30_000);
      assert.equal(await editor.page.$('dialog[open]'), null);
      const now = (await api(admin.page, 'GET', `/api/menus/${menu.id}`)).json;
      assert.equal(now.published, null);
      assert.ok(now.draft, 'the draft is kept');
      assert.deepEqual(editor.errors, []);
    } finally {
      await editor.page.browserContext().close();
    }
  });

  it('no unexpected console or page errors', () => {
    assert.deepEqual([...admin.errors, ...chef.errors], []);
  });
});
