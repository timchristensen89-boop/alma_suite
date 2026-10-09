/**
 * A private-event menu, end to end: New menu as a private event (kind,
 * event details, private by default), courses with prices hidden in the
 * editor and the A5 preview, publish, the public endpoints refusing it, a
 * duplicate for the next event, and archive. The menus end archived.
 * See helpers.mjs for how to run.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { E2E, api, clickByText, launch, screenshot, session, skipReason, text, waitForText } from './helpers.mjs';

describe('private-event menus, end to end', { skip: skipReason }, () => {
  let browser;
  let admin;
  const name = `E2E Wedding ${Date.now().toString(36)}`;
  let menuId = '';
  let copyId = '';
  let venueId = '';

  before(async () => {
    browser = await launch();
    admin = await session(browser, E2E.adminEmail);
  });

  after(async () => {
    for (const id of [copyId, menuId]) if (admin && id) await api(admin.page, 'POST', `/api/menus/${id}/archive`).catch(() => undefined);
    await browser?.close();
  });

  const select = (page, id, label) =>
    page.evaluate(
      (selector, wanted) => {
        const element = document.querySelector(selector);
        const option = [...element.options].find((candidate) => candidate.textContent.trim() === wanted || candidate.value === wanted);
        if (!option) throw new Error(`No option "${wanted}" in ${selector}: ${[...element.options].map((o) => o.textContent).join(' | ')}`);
        element.value = option.value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
      },
      id,
      label
    );

  it('New menu offers Private event with its details and keeps it private', async () => {
    const page = admin.page;
    const home = (await api(page, 'GET', '/api/menus')).json;
    venueId = home.venues.find((venue) => venue.slug === 'st-alma').id;
    await page.goto(E2E.base, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.menus-venue', { timeout: 15_000 });
    await clickByText(page, 'button', 'New menu');
    await page.waitForSelector('#new-menu-name', { timeout: 10_000 });
    await select(page, '#new-menu-venue', 'St Alma').catch(() => undefined);
    await select(page, '#new-menu-kind', 'PRIVATE_EVENT');
    await page.waitForSelector('#new-menu-event-name', { timeout: 10_000 });
    await page.type('#new-menu-name', name);
    await page.type('#new-menu-heading', 'Harriet & Tom');
    await page.type('#new-menu-event-name', 'Smith wedding');
    await page.evaluate(() => {
      // A controlled React input ignores a plain `.value =`: go through the native setter so React sees the change.
      const input = document.querySelector('#new-menu-event-date');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2026-11-14');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.type('#new-menu-guests', '40');
    await select(page, '#new-menu-source', 'Start empty').catch(() => undefined);
    const body = await text(page);
    assert.ok(body.includes('Private-event menus stay private'), 'the dialog says private-event menus stay private');
    await screenshot(page, 'event-01-new-menu');
    await clickByText(page, 'button', 'Create and open');
    await page.waitForFunction(() => /\/menus\/[^/]+\/edit$/.test(location.pathname), { timeout: 15_000 });
    menuId = page.url().split('/').slice(-2)[0];
    const summary = (await api(page, 'GET', `/api/menus/${menuId}`)).json;
    assert.equal(summary.kind, 'PRIVATE_EVENT');
    assert.equal(summary.visibility, 'PRIVATE');
    assert.equal(summary.templateKey, 'freshwater_card_a5');
    assert.equal(summary.event.eventName, 'Smith wedding');
    assert.equal(summary.event.guestCount, 40);
    assert.match(summary.event.eventDate ?? '', /^2026-11-14/);
  });

  it('courses with hidden prices print on the A5 card, and the preview shows two pages when declared', async () => {
    const page = admin.page;
    const draft = (await api(page, 'GET', `/api/menus/${menuId}/draft`)).json;
    const item = (dishName, description, tags = []) => ({ name: dishName, description, priceCents: 1200, priceUnit: null, prices: [], meta: null, note: null, flags: [], tags, isSeafood: false, visible: true, recipeId: null });
    const section = (title, page, items, over = {}) => ({ title, headerSuffix: null, subheading: null, sectionType: 'COURSE', placement: 'LEFT', page, lead: null, body: null, priceColumns: [], visible: true, items, ...over });
    const saved = await api(page, 'PUT', `/api/menus/${menuId}/draft`, {
      ...draft.document,
      heading: 'Harriet & Tom',
      subheading: 'Saturday 14 November 2026',
      showPrices: false,
      pageCount: 2,
      sections: [
        section('To start', 1, [item('Guacamole, salsa macha, tostadas', 'For the table', ['VG', 'GFA'])]),
        section('Tacos', 1, [item('Barramundi', 'Pickled cabbage, chipotle aioli', ['GFA', 'DF', 'A']), item('Nopal', 'Avocado salsa, fried potato', ['VG'])], { lead: 'Two per person' }),
        section('From the grill', 2, [item('Agave beef short rib', 'Grilled cos, tortillas', ['GF', 'DF'])], { lead: 'Choose one' }),
        section('Something sweet', 2, [item('Churros', 'Almond and white chocolate ganache', ['V', 'N'])])
      ],
      expectedUpdatedAt: draft.version.updatedAt
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    await page.goto(`${E2E.base}/menus/${menuId}/edit`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.editor-form', { timeout: 15_000 });
    await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.body?.textContent?.includes('Harriet & Tom'), { timeout: 20_000 });
    const body = await text(page);
    assert.ok(body.includes('No prices on the print'), 'the show-prices switch reads off');
    await page.waitForFunction(() => (document.querySelector('iframe')?.contentDocument?.querySelectorAll('.sheet').length ?? 0) === 2, { timeout: 20_000 });
    const printed = await page.evaluate(() => document.querySelector('iframe').contentDocument.body.textContent.replace(/\s+/g, ' '));
    assert.ok(printed.includes('Harriet & Tom'));
    assert.ok(printed.includes('Barramundi'));
    assert.ok(!printed.includes('12'), 'no price prints on a hidden-price menu');
    await screenshot(page, 'event-02-editor');
  });

  it('publishes, and the public endpoints refuse a private menu', async () => {
    const page = admin.page;
    const preview = await api(page, 'POST', `/api/menus/${menuId}/draft/preview`);
    assert.equal(preview.status, 200);
    assert.equal(preview.json.canPublish, true, JSON.stringify(preview.json.validation));
    const published = await api(page, 'POST', `/api/menus/${menuId}/draft/publish`, { acknowledgeWarnings: true });
    assert.ok(published.status === 200 || published.status === 201, JSON.stringify(published.json));
    assert.equal(published.json.version.pageCount, 2);
    const summary = (await api(page, 'GET', `/api/menus/${menuId}`)).json;
    const listed = await fetch(`${E2E.api}/api/public/menus/st-alma`).then((response) => response.json());
    assert.ok(!listed.menus.some((menu) => menu.slug === summary.slug), 'a private menu is not listed publicly');
    assert.equal((await fetch(`${E2E.api}/api/public/menus/st-alma/${summary.slug}.pdf`)).status, 404);
    assert.equal((await fetch(`${E2E.api}/api/public/menus/st-alma/${summary.slug}.json`)).status, 404);
    assert.equal((await fetch(`${E2E.api}/api/public/menus/version/${summary.published.id}.pdf`)).status, 404, 'not even by version id');
    // The team can still open and print it from History.
    const pdf = await api(page, 'GET', `/api/menus/versions/${summary.published.id}`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.json.version.hasPdf, true);
  });

  it('a duplicate for the next event starts from the published menu and stays private; both end archived', async () => {
    const page = admin.page;
    const copy = await api(page, 'POST', '/api/menus', { venueId, name: `${name} copy`, kind: 'PRIVATE_EVENT', copyFromMenuId: menuId, heading: 'Priya & Sam', eventName: 'Patel wedding', eventDate: '2026-12-05', guestCount: 60 });
    assert.equal(copy.status, 201, JSON.stringify(copy.json));
    copyId = copy.json.id;
    assert.equal(copy.json.visibility, 'PRIVATE');
    const draft = (await api(page, 'GET', `/api/menus/${copyId}/draft`)).json;
    assert.equal(draft.document.heading, 'Priya & Sam');
    assert.equal(draft.document.showPrices, false);
    assert.equal(draft.document.sections.length, 4);
    assert.equal(draft.document.sections[1].items[0].name, 'Barramundi');
    await page.goto(E2E.base, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.menus-venue', { timeout: 15_000 });
    await waitForText(page, 'Private events');
    const body = await text(page);
    assert.ok(body.includes('Patel wedding'), 'the home shows the event on the card');
    await screenshot(page, 'event-03-home');
  });
});
