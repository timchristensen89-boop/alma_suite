/**
 * Browser regression tests for ALMA Menus, driven with puppeteer-core against
 * a running API and menus-web. They need a disposable database, never
 * production: each run creates menus named "E2E …" and leaves them archived.
 *
 * Needs, in that database: the venues `st-alma` and `alma-avalon`, each with a
 * published menu (`pnpm db:seed:prod` then `pnpm db:seed:menus`); a publisher
 * account and a draft-only chef account (MENUS access at USER), sharing one
 * password.
 *
 *   MENUS_E2E_BASE_URL=http://127.0.0.1:5181 \
 *   MENUS_E2E_API_URL=http://127.0.0.1:3018 \
 *   MENUS_E2E_ADMIN_EMAIL=… MENUS_E2E_CHEF_EMAIL=… MENUS_E2E_PASSWORD=… \
 *   MENUS_E2E_CHROME=/path/to/chrome \            # optional, see chromePath()
 *     pnpm --filter @alma/menus-web test:e2e
 *
 * Without MENUS_E2E_BASE_URL every suite reports as skipped.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

export const E2E = {
  base: process.env.MENUS_E2E_BASE_URL ?? '',
  api: process.env.MENUS_E2E_API_URL ?? 'http://127.0.0.1:3018',
  adminEmail: process.env.MENUS_E2E_ADMIN_EMAIL ?? '',
  chefEmail: process.env.MENUS_E2E_CHEF_EMAIL ?? '',
  password: process.env.MENUS_E2E_PASSWORD ?? ''
};

export const skipReason = E2E.base ? false : 'skipped: set MENUS_E2E_BASE_URL (and the other MENUS_E2E_* variables) to run';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** MENUS_E2E_CHROME, else a Playwright-managed Chromium, else the usual system paths. */
function chromePath() {
  if (process.env.MENUS_E2E_CHROME) return process.env.MENUS_E2E_CHROME;
  for (const root of [process.env.PLAYWRIGHT_BROWSERS_PATH, join(process.env.HOME ?? '', '.cache/ms-playwright')].filter(Boolean)) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse()) {
      const candidate = join(root, dir, 'chrome-linux', 'chrome');
      if (existsSync(candidate)) return candidate;
    }
  }
  return ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((path) => existsSync(path));
}

export async function launch() {
  const executablePath = chromePath();
  if (!executablePath) throw new Error('No Chrome found: set MENUS_E2E_CHROME.');
  return puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
}

/** A signed-in tab in its own browser context (its own storage), with errors collected. 409/403 resource lines are expected answers, not errors. */
export async function session(browser, email) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1360, height: 1000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/status of (409|403)|net::ERR_FAILED/.test(message.text())) errors.push(message.text());
  });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto(E2E.base, { waitUntil: 'networkidle0' });
  await page.type('input[type=email]', email);
  await page.type('input[type=password]', E2E.password);
  await page.click('button[type=submit]');
  await page.waitForSelector('.menus-venue', { timeout: 15_000 });
  return { page, errors };
}

/** Call the API as the page's signed-in user. */
export async function api(page, method, path, body) {
  return page.evaluate(
    async (base, method, path, body) => {
      const token = localStorage.getItem('alma.menus.session');
      const response = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined
      });
      let json = null;
      try {
        json = await response.json();
      } catch {
        // empty body
      }
      return { status: response.status, json };
    },
    E2E.api,
    method,
    path,
    body
  );
}

export const text = (page) => page.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));

export async function waitForText(page, needle, timeout = 15_000) {
  await page.waitForFunction((value) => document.body.textContent.replace(/\s+/g, ' ').includes(value), { timeout }, needle);
}

export async function clickByText(page, selector, label) {
  const handle = await page.evaluateHandle(
    (sel, value) => [...document.querySelectorAll(sel)].find((element) => element.textContent.trim() === value || element.getAttribute('aria-label') === value) ?? null,
    selector,
    label
  );
  const element = handle.asElement();
  if (!element) throw new Error(`No ${selector} "${label}" on the page.`);
  await element.click();
}

/** The editor's printed-heading input (the first field of the form). */
export async function headingInput(page) {
  const handle = await page.evaluateHandle(() => document.querySelector('.editor-form input.field-control'));
  const element = handle.asElement();
  if (!element) throw new Error('No heading input: the editor is not showing a draft.');
  return element;
}

/** The input under a field label, e.g. "Dietary note". */
export async function fieldByLabel(page, label) {
  const handle = await page.evaluateHandle(
    (value) => [...document.querySelectorAll('.editor-form label.field')].find((field) => field.querySelector('.field-label')?.textContent?.trim() === value)?.querySelector('input') ?? null,
    label
  );
  const element = handle.asElement();
  if (!element) throw new Error(`No field labelled "${label}".`);
  return element;
}

export async function replaceValue(page, element, value) {
  await element.evaluate((node) => {
    node.focus();
    node.select();
  });
  await page.keyboard.press('Backspace');
  await page.keyboard.type(value);
}

export async function appendValue(page, element, value) {
  await element.evaluate((node) => {
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  });
  await page.keyboard.type(value);
}

export const keptCopy = (page, menuId) => page.evaluate((id) => localStorage.getItem(`alma.menus.unsaved.${id}`), menuId);

export async function serverHeading(adminPage, menuId) {
  return (await api(adminPage, 'GET', `/api/menus/${menuId}/draft`)).json?.document?.heading;
}

/** A fresh menu at St Alma, copied from its live menu, with a draft. Names are unique per run. */
export async function newMenu(adminPage, label) {
  const home = (await api(adminPage, 'GET', '/api/menus')).json;
  const venue = home.venues.find((candidate) => candidate.slug === 'st-alma');
  const live = home.menus.find((menu) => menu.venue.id === venue.id && menu.published);
  if (!venue || !live) throw new Error('Needs the st-alma venue with a published menu (pnpm db:seed:menus).');
  const created = await api(adminPage, 'POST', '/api/menus', { venueId: venue.id, name: `E2E ${label} ${Date.now().toString(36)}`, copyFromMenuId: live.id });
  if (created.status !== 201) throw new Error(`Could not create a menu: ${created.status} ${JSON.stringify(created.json)}`);
  return created.json;
}
