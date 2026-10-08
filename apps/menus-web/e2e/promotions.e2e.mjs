/**
 * What's On, end to end: a publisher adds a promotion with its card, types
 * the listing (times, price, conditions), sees the card editor show those
 * fields read-only, publishes listing and card together, hides and ends it;
 * a draft-only chef can edit the listing but not publish. The public
 * endpoint is checked after each step so what the website would receive is
 * asserted, not inferred. The promotion ends ENDED so the list stays tidy.
 * See helpers.mjs for how to run.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { E2E, api, clickByText, launch, replaceValue, screenshot, session, skipReason, sleep, text, waitForText } from './helpers.mjs';

describe('promotions (What’s On), end to end', { skip: skipReason }, () => {
  let browser;
  let admin;
  let chef;
  const name = `E2E Promo ${Date.now().toString(36)}`;
  let promotionId = '';
  let cardId = '';
  let slug = '';

  before(async () => {
    browser = await launch();
    admin = await session(browser, E2E.adminEmail);
  });

  after(async () => {
    if (admin && promotionId) await api(admin.page, 'POST', `/api/menus/promotions/${promotionId}/end`).catch(() => undefined);
    if (admin && cardId) await api(admin.page, 'POST', `/api/menus/${cardId}/archive`).catch(() => undefined);
    await browser?.close();
  });

  const publicListing = async () => {
    const response = await fetch(`${E2E.api}/api/public/whats-on/st-alma`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    return payload.promotions.find((item) => item.slug === slug) ?? null;
  };

  /** The input or textarea under a field label on the promotion page. */
  const field = async (page, label) => {
    const handle = await page.evaluateHandle(
      (value) => [...document.querySelectorAll('label.field')].find((node) => node.querySelector('.field-label')?.textContent?.trim() === value)?.querySelector('input, textarea') ?? null,
      label
    );
    const element = handle.asElement();
    if (!element) throw new Error(`No field labelled "${label}".`);
    return element;
  };

  it('a publisher adds a promotion with a new card and lands on its page', async () => {
    const page = admin.page;
    await page.goto(`${E2E.base}/whats-on`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'What’s On');
    await clickByText(page, 'button', 'New promotion');
    await page.waitForSelector('#new-promotion-name', { timeout: 10_000 });
    const venueSelect = await page.$('#new-promotion-venue');
    if (venueSelect) {
      await page.evaluate(() => {
        const select = document.querySelector('#new-promotion-venue');
        const option = [...select.options].find((candidate) => candidate.textContent === 'St Alma');
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    await page.type('#new-promotion-name', name);
    await page.type('#new-promotion-title', `${name} on the website`);
    await clickByText(page, 'button', 'Add and open');
    await page.waitForFunction(() => /\/whats-on\/[^/]+$/.test(location.pathname), { timeout: 15_000 });
    promotionId = page.url().split('/').pop();
    await waitForText(page, `St Alma · ${name}`);
    const detail = (await api(page, 'GET', `/api/menus/promotions/${promotionId}`)).json;
    slug = detail.slug;
    cardId = detail.card?.id ?? '';
    assert.ok(cardId, 'a card was made with the promotion');
    assert.equal(detail.card.kind, 'PROMOTION');
    assert.equal(detail.status, 'DRAFT');
    assert.equal(await publicListing(), null, 'nothing is public yet');
    await screenshot(page, 'promo-01-new');
  });

  it('typing the listing and saving updates the preview and the public item stays unpublished', async () => {
    const page = admin.page;
    await replaceValue(page, await field(page, 'Time line'), 'Fri–Sun · 12–4pm');
    await replaceValue(page, await field(page, 'Day label'), 'Fri–Sun');
    await replaceValue(page, await field(page, 'Description'), 'A long lunch with the margaritas close behind.');
    const price = await page.$('input[aria-label="Price in dollars"]');
    await replaceValue(page, price, '99');
    await replaceValue(page, await field(page, 'Conditions'), 'Two hours from your sitting time.');
    await waitForText(page, 'Unsaved changes');
    await clickByText(page, 'button', 'Save');
    await waitForText(page, 'Saved today');
    const body = await text(page);
    assert.ok(body.includes('$99 pp'), 'the preview shows the derived price label');
    assert.ok(body.includes('A long lunch with the margaritas close behind.'));
    const detail = (await api(page, 'GET', `/api/menus/promotions/${promotionId}`)).json;
    assert.equal(detail.fields.heroPriceCents, 9900);
    assert.equal(detail.fields.timeLabel, 'Fri–Sun · 12–4pm');
    assert.equal(await publicListing(), null, 'saving is not publishing');
    await screenshot(page, 'promo-02-listing');
  });

  it('the card editor shows the promotion’s when-line, price and conditions read-only', async () => {
    const page = admin.page;
    await page.goto(`${E2E.base}/menus/${cardId}/edit`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid="promotion-owned"]', { timeout: 15_000 });
    const body = await text(page);
    assert.ok(body.includes(`From the promotion “${name}”`));
    assert.ok(body.includes('Fri–Sun · 12–4pm'));
    assert.ok(body.includes('99 pp'));
    assert.ok(body.includes('Two hours from your sitting time.'));
    assert.equal(await page.$('input[aria-label="Headline price in dollars"]'), null, 'no editable price on a promotion’s card');
    // Give the card something to print.
    const draft = (await api(page, 'GET', `/api/menus/${cardId}/draft`)).json;
    const saved = await api(page, 'PUT', `/api/menus/${cardId}/draft`, {
      ...draft.document,
      sections: [
        {
          title: 'To start',
          headerSuffix: null,
          subheading: null,
          sectionType: 'LIST',
          placement: 'LEFT',
          page: 1,
          lead: null,
          body: null,
          priceColumns: [],
          visible: true,
          items: [{ name: 'Guacamole, salsa macha, tostadas', description: null, priceCents: null, priceUnit: null, prices: [], meta: null, note: null, flags: [], tags: ['VG'], isSeafood: false, visible: true, recipeId: null }]
        }
      ],
      expectedUpdatedAt: draft.version.updatedAt
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.document.whenLine, 'Fri–Sun · 12–4pm', 'the overlay survives a save');
    await screenshot(page, 'promo-03-card-editor');
  });

  it('publishing puts the listing and the card’s PDF on the public endpoint together', async () => {
    const page = admin.page;
    await page.goto(`${E2E.base}/whats-on/${promotionId}`, { waitUntil: 'networkidle0' });
    await waitForText(page, `St Alma · ${name}`);
    await clickByText(page, 'button', 'Publish…');
    await waitForText(page, 'The printed card', 20_000);
    await waitForText(page, 'The card has a draft', 20_000);
    await screenshot(page, 'promo-04-publish-dialog');
    await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] button')].some((button) => /^Publish/.test(button.textContent.trim()) && !button.disabled), { timeout: 20_000 });
    await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find((button) => /^Publish/.test(button.textContent.trim()) && !button.disabled).click());
    await waitForText(page, 'Published. The website lists it and the card', 30_000);
    await waitForText(page, 'Live');
    const item = await publicListing();
    assert.ok(item, 'the promotion is on the public What’s On');
    assert.equal(item.title, `${name} on the website`);
    assert.equal(item.priceLabel, '$99 pp');
    assert.equal(item.timeLabel, 'Fri–Sun · 12–4pm');
    assert.ok(item.card, 'the listing carries the card');
    assert.match(item.card.pdfUrl, /\/api\/public\/menus\/version\/[^/]+\.pdf$/);
    const pdf = await fetch(item.card.pdfUrl);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    const card = (await api(page, 'GET', `/api/menus/${cardId}`)).json;
    assert.equal(card.published?.versionNumber, 1, 'the card was published with the listing');
    assert.equal(card.draft, null);
    await screenshot(page, 'promo-05-live');
  });

  it('a draft-only chef can edit the listing but sees no Publish, Hide or End', async () => {
    chef = await session(browser, E2E.chefEmail);
    const page = chef.page;
    await page.goto(`${E2E.base}/whats-on/${promotionId}`, { waitUntil: 'networkidle0' });
    await waitForText(page, `St Alma · ${name}`);
    const body = await text(page);
    assert.ok(body.includes('Managers and the head chef publish.'));
    assert.ok(!body.includes('Hide from website'));
    assert.equal((await api(page, 'POST', `/api/menus/promotions/${promotionId}/publish`, { acknowledgeWarnings: true })).status, 403);
    await replaceValue(page, await field(page, 'Description'), 'A long lunch, edited by the chef.');
    await clickByText(page, 'button', 'Save');
    await waitForText(page, 'Saved today');
    await waitForText(page, 'Not yet on the website: description');
    const item = await publicListing();
    assert.equal(item.summary, 'A long lunch with the margaritas close behind.', 'the website keeps the published copy');
    await screenshot(page, 'promo-06-chef');
  });

  it('hide takes it off the website and keeps the publication; end retires it', async () => {
    const page = admin.page;
    await page.goto(`${E2E.base}/whats-on/${promotionId}`, { waitUntil: 'networkidle0' });
    await waitForText(page, `St Alma · ${name}`);
    await clickByText(page, 'button', 'Hide from website');
    await waitForText(page, 'Hidden from the website.');
    assert.equal(await publicListing(), null);
    await clickByText(page, 'button', 'Show on website');
    await waitForText(page, 'Back on the website.');
    assert.ok(await publicListing());
    await clickByText(page, 'button', 'End');
    await waitForText(page, 'Ended.');
    assert.equal(await publicListing(), null);
    await page.goto(`${E2E.base}/whats-on`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'Ended (');
    assert.ok((await text(page)).includes(`St Alma · ${name}`));
    await screenshot(page, 'promo-07-ended');
    await sleep(100);
  });
});
