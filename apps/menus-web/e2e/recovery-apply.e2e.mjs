/**
 * Applying recovered edits: the copy kept in the browser when a menu was
 * archived mid-edit must survive until the server confirms a save that holds
 * those edits. A rejected save, a network failure or a reload keeps it; a
 * save that went out before the apply never clears it. See helpers.mjs for
 * how to run.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  E2E,
  api,
  appendValue,
  clickByText,
  fieldByLabel,
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

const BASE_HEADING = 'Kept edit base';
const RECOVERED_HEADING = 'Kept edit base + unsaved';

describe('applying recovered edits', { skip: skipReason }, () => {
  let browser;
  let admin;
  let chef;

  before(async () => {
    browser = await launch();
    admin = await session(browser, E2E.adminEmail);
    chef = await session(browser, E2E.chefEmail);
  });

  after(async () => {
    await browser?.close();
  });

  /**
   * A menu whose draft has a kept, unsaved edit waiting to be applied: the
   * chef saves a heading, a publisher archives the menu, the chef's next edit
   * is refused and kept, the menu is unarchived, the chef reopens the editor.
   */
  async function menuWithKeptEdit(label) {
    const menu = await newMenu(admin.page, label);
    const page = chef.page;
    await page.goto(`${E2E.base}/menus/${menu.id}/edit`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.editor-form');
    await replaceValue(page, await headingInput(page), BASE_HEADING);
    await page.waitForFunction(() => /Saved today/.test(document.body.textContent), { timeout: 15_000 });
    await sleep(200);
    assert.equal(await serverHeading(admin.page, menu.id), BASE_HEADING);

    assert.equal((await api(admin.page, 'POST', `/api/menus/${menu.id}/archive`)).status, 200);
    await appendValue(page, await headingInput(page), ' + unsaved');
    await waitForText(page, 'This menu is archived');
    assert.ok(await keptCopy(page, menu.id), 'the refused edit should be kept in the browser');

    assert.equal((await api(admin.page, 'POST', `/api/menus/${menu.id}/unarchive`)).status, 200);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.editor-form');
    await waitForText(page, 'Apply to this draft');
    return menu;
  }

  async function assertRecoveryOffered(menuId, when) {
    const body = await text(chef.page);
    assert.ok(body.includes('Unsaved changes from'), `${when}: the recovery card should still be shown`);
    const kept = await keptCopy(chef.page, menuId);
    assert.ok(kept, `${when}: the kept copy should still be in browser storage`);
    assert.equal(JSON.parse(kept).document.heading, RECOVERED_HEADING, `${when}: the kept copy should be the recovered edit`);
  }

  async function assertRecoveryCleared(menuId) {
    await chef.page.waitForFunction(() => !document.body.textContent.includes('Unsaved changes from'), { timeout: 15_000 });
    assert.equal(await keptCopy(chef.page, menuId), null, 'the kept copy should be cleared once the server saved it');
    assert.equal(await serverHeading(admin.page, menuId), RECOVERED_HEADING);
  }

  it('apply, save rejected because someone else saved, reload their changes: the recovered edit is still offered; applying again saves it and clears the copy', async () => {
    const menu = await menuWithKeptEdit('Conflict');
    // Another editor saves while the chef looks at the recovery card.
    const current = (await api(admin.page, 'GET', `/api/menus/${menu.id}/draft`)).json;
    assert.equal((await api(admin.page, 'PUT', `/api/menus/${menu.id}/draft`, { ...current.document, heading: 'Saved by someone else' })).status, 200);

    await clickByText(chef.page, 'button', 'Apply to this draft');
    await waitForText(chef.page, 'Reload their changes');
    await assertRecoveryOffered(menu.id, 'after the rejected save');
    assert.equal(await serverHeading(admin.page, menu.id), 'Saved by someone else');

    await clickByText(chef.page, 'button', 'Reload their changes');
    await chef.page.waitForFunction(() => document.querySelector('.editor-form input.field-control')?.value === 'Saved by someone else', { timeout: 15_000 });
    await waitForText(chef.page, 'Apply to this draft');
    await assertRecoveryOffered(menu.id, 'after reloading their changes');

    await clickByText(chef.page, 'button', 'Apply to this draft');
    await assertRecoveryCleared(menu.id);
  });

  it('apply, save fails on the network, page reloaded: the recovered edit is still offered', async () => {
    const menu = await menuWithKeptEdit('Network');
    const page = chef.page;
    const isSave = (request) => request.method() === 'PUT' && request.url().endsWith(`/api/menus/${menu.id}/draft`);
    let aborted = 0;
    const abortSaves = (request) => {
      if (!isSave(request)) return void request.continue();
      aborted += 1;
      void request.abort('failed');
    };
    await page.setRequestInterception(true);
    page.on('request', abortSaves);
    try {
      await clickByText(page, 'button', 'Apply to this draft');
      // "Not saved yet" is the card's line for an applied copy whose save failed (the subtitle's "Not saved when…" is always there).
      await waitForText(page, 'Not saved yet');
      assert.ok(aborted >= 1, 'a save was actually attempted and refused');
      await assertRecoveryOffered(menu.id, 'after the failed save');
      assert.ok((await text(page)).includes('Apply again'), 'the card offers to apply again');
    } finally {
      page.off('request', abortSaves);
      await page.setRequestInterception(false);
    }
    assert.equal(await serverHeading(admin.page, menu.id), BASE_HEADING);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.editor-form');
    await waitForText(page, 'Apply to this draft');
    await assertRecoveryOffered(menu.id, 'after a page reload');
  });

  it('a save that went out before the apply cannot clear the recovered edit; the save that carries it does', async () => {
    const menu = await menuWithKeptEdit('In flight');
    const page = chef.page;
    const isSave = (request) => request.method() === 'PUT' && request.url().endsWith(`/api/menus/${menu.id}/draft`);
    const held = [];
    const hold = (request) => (isSave(request) ? void held.push(request) : void request.continue());
    await page.setRequestInterception(true);
    page.on('request', hold);
    try {
      // An ordinary edit; its autosave leaves and is held on the wire.
      await replaceValue(page, await fieldByLabel(page, 'Dietary note'), 'An edit made before applying');
      for (let waited = 0; held.length < 1; waited += 50) {
        if (waited > 10_000) throw new Error('the first save never left');
        await sleep(50);
      }
      // Apply while that older save is still in flight.
      await clickByText(page, 'button', 'Apply to this draft');
      await sleep(2_000); // past the autosave delay: the next save queues behind the one in flight

      const older = page.waitForResponse((response) => isSave(response.request()) && response.request() === held[0], { timeout: 15_000 });
      held[0].continue();
      assert.equal((await older).status(), 200, 'the older save itself succeeds');
      for (let waited = 0; held.length < 2; waited += 50) {
        if (waited > 10_000) throw new Error('the save carrying the applied edit never left');
        await sleep(50);
      }
      await assertRecoveryOffered(menu.id, 'after the older save succeeded');

      const newer = page.waitForResponse((response) => response.request() === held[1], { timeout: 15_000 });
      held[1].continue();
      assert.equal((await newer).status(), 200);
      await assertRecoveryCleared(menu.id);
    } finally {
      page.off('request', hold);
      for (const request of held.slice(2)) request.continue();
      await page.setRequestInterception(false);
    }
  });

  it('a newer kept copy written while an apply is still saving is not cleared by that save', async () => {
    const menu = await menuWithKeptEdit('Newer copy');
    const page = chef.page;
    const isSave = (request) => request.method() === 'PUT' && request.url().endsWith(`/api/menus/${menu.id}/draft`);
    const held = [];
    const hold = (request) => (isSave(request) ? void held.push(request) : void request.continue());
    await page.setRequestInterception(true);
    page.on('request', hold);
    try {
      await clickByText(page, 'button', 'Apply to this draft');
      for (let waited = 0; held.length < 1; waited += 50) {
        if (waited > 10_000) throw new Error('the save carrying the applied edit never left');
        await sleep(50);
      }
      // Another tab of this browser keeps a newer copy for the same menu while that save is on the wire.
      const newerId = await page.evaluate((id) => {
        const key = `alma.menus.unsaved.${id}`;
        const stored = JSON.parse(localStorage.getItem(key));
        const newer = { ...stored, id: `newer-${Date.now()}`, keptAt: new Date().toISOString(), document: { ...stored.document, heading: 'Kept by another tab' } };
        localStorage.setItem(key, JSON.stringify(newer));
        return newer.id;
      }, menu.id);
      const response = page.waitForResponse((candidate) => candidate.request() === held[0], { timeout: 15_000 });
      held[0].continue();
      assert.equal((await response).status(), 200);
      await page.waitForFunction(() => document.body.textContent.includes('recovered changes are saved'), { timeout: 15_000 });
      const kept = JSON.parse(await keptCopy(page, menu.id));
      assert.equal(kept.id, newerId, 'the newer copy is still there');
      assert.equal(kept.document.heading, 'Kept by another tab');
      assert.equal(await serverHeading(admin.page, menu.id), RECOVERED_HEADING);
    } finally {
      page.off('request', hold);
      for (const request of held.slice(1)) request.continue();
      await page.setRequestInterception(false);
    }
  });

  it('a copy kept in the old format (no id) is offered, applied, saved and cleared', async () => {
    const menu = await newMenu(admin.page, 'Legacy');
    const page = chef.page;
    await page.goto(`${E2E.base}/menus/${menu.id}/edit`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.editor-form');
    const draft = (await api(admin.page, 'GET', `/api/menus/${menu.id}/draft`)).json;
    await page.evaluate(
      (id, label, document) => {
        localStorage.setItem(`alma.menus.unsaved.${id}`, JSON.stringify({ menuId: id, menuLabel: label, draftVersionNumber: 1, keptAt: '2026-10-01T10:00:00.000Z', document }));
      },
      menu.id,
      `St Alma · ${menu.name}`,
      { ...draft.document, heading: 'From the old format' }
    );
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.editor-form');
    await waitForText(page, 'Apply to this draft');
    await clickByText(page, 'button', 'Apply to this draft');
    await page.waitForFunction(() => !document.body.textContent.includes('Unsaved changes from'), { timeout: 15_000 });
    assert.equal(await serverHeading(admin.page, menu.id), 'From the old format');
    assert.equal(await keptCopy(page, menu.id), null);
  });

  it('publishing right after apply, while an older save is still on the wire, publishes the recovered edits', async () => {
    const menu = await menuWithKeptEdit('Publish after apply');
    // Publishing needs a publisher: the admin opens the same draft, with the same kept copy in its browser.
    const page = admin.page;
    const copy = await keptCopy(chef.page, menu.id);
    await page.goto(`${E2E.base}/menus/${menu.id}/edit`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.editor-form');
    await page.evaluate((id, value) => localStorage.setItem(`alma.menus.unsaved.${id}`, value), menu.id, copy);
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.editor-form');
    await waitForText(page, 'Apply to this draft');
    const isSave = (request) => request.method() === 'PUT' && request.url().endsWith(`/api/menus/${menu.id}/draft`);
    const held = [];
    const hold = (request) => (isSave(request) && held.length === 0 ? void held.push(request) : void request.continue());
    await page.setRequestInterception(true);
    page.on('request', hold);
    try {
      await replaceValue(page, await fieldByLabel(page, 'Dietary note'), 'Typed before the apply');
      for (let waited = 0; held.length < 1; waited += 50) {
        if (waited > 10_000) throw new Error('the first save never left');
        await sleep(50);
      }
      await clickByText(page, 'button', 'Apply to this draft');
      await clickByText(page, 'button', 'Publish…');
      held[0].continue();
      await page.waitForSelector('dialog[open] .menu-dialog-status', { timeout: 30_000 });
      assert.equal(await serverHeading(admin.page, menu.id), RECOVERED_HEADING, 'the recovered edit reached the server before the publish preview');
      // This menu has never been published, so the dialog is a first publish (no heading row to show); the server check above is the proof.
      const dialog = await page.$eval('dialog[open]', (element) => element.textContent);
      assert.ok(dialog.includes('first published version'), dialog.slice(0, 200));
      await clickByText(page, 'dialog[open] button', 'Back to editing');
      await page.waitForFunction(() => !document.body.textContent.includes('Unsaved changes from'), { timeout: 15_000 });
      assert.equal(await keptCopy(page, menu.id), null);
    } finally {
      page.off('request', hold);
      await page.setRequestInterception(false);
    }
  });

  it('no unexpected console or page errors', () => {
    assert.deepEqual([...admin.errors, ...chef.errors], []);
  });
});
