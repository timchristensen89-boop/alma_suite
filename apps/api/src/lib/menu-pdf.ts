import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import puppeteer, { type Browser } from 'puppeteer-core';
import { MENU_FILL_PROBE_SCRIPT, type MenuFillReport } from '@alma/shared';
import { env } from '../env.js';
import { HttpError } from './http.js';

/**
 * Headless Chrome, driving the same HTML the editor previews, to the PDF the
 * venue prints. Chrome because the current menus were made by Chrome (Skia/PDF
 * m141) and the layout — hairlines, letterspacing, text-wrap:pretty — is
 * Chrome's; any other engine would be a different menu.
 *
 * One browser per process, launched on first use and reused; one page per
 * render, closed after. A render is a few hundred milliseconds once the
 * browser is warm, well inside the fifteen seconds the brief allows for a
 * publish from the pass.
 */

const CHROME_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
];

/** A Playwright-managed Chromium (PLAYWRIGHT_BROWSERS_PATH or ~/.cache/ms-playwright) when present. */
function playwrightChromium(): string | null {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH ?? '', join(process.env.HOME ?? '', '.cache/ms-playwright')].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort()
      .reverse();
    for (const dir of dirs) {
      for (const candidate of [join(root, dir, 'chrome-linux/chrome'), join(root, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium')]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

export function resolveChromePath(): string | null {
  if (env.menus.chromePath) return existsSync(env.menus.chromePath) ? env.menus.chromePath : null;
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) ?? playwrightChromium();
}

export function chromeStatus(): { ok: boolean; path: string | null; message: string } {
  const path = resolveChromePath();
  if (path) return { ok: true, path, message: `Headless Chrome at ${path}` };
  return {
    ok: false,
    path: null,
    message: env.menus.chromePath
      ? `MENU_CHROME_PATH points at ${env.menus.chromePath}, which does not exist.`
      : 'No Chrome/Chromium binary found. Install the chromium package or set MENU_CHROME_PATH.'
  };
}

let browserPromise: Promise<Browser> | null = null;

async function browser(): Promise<Browser> {
  if (browserPromise) {
    const existing = await browserPromise.catch(() => null);
    if (existing && existing.connected) return existing;
    browserPromise = null;
  }
  const executablePath = resolveChromePath();
  if (!executablePath) {
    throw new HttpError(503, `The menu PDF renderer is not available on this server. ${chromeStatus().message}`);
  }
  browserPromise = puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars']
  });
  const launched = await browserPromise;
  launched.once('disconnected', () => {
    browserPromise = null;
  });
  return launched;
}

export async function closeMenuBrowser(): Promise<void> {
  const current = browserPromise;
  browserPromise = null;
  if (!current) return;
  const instance = await current.catch(() => null);
  await instance?.close().catch(() => undefined);
}

export type MenuRenderResult = {
  pdf: Buffer;
  fill: MenuFillReport;
  pageCount: number;
  renderMs: number;
};

const RENDER_TIMEOUT_MS = 20_000;

async function withPage<T>(html: string, fn: (page: Awaited<ReturnType<Browser['newPage']>>) => Promise<T>): Promise<T> {
  const instance = await browser();
  const page = await instance.newPage();
  try {
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    // A4 at 96dpi, so screen-media measurements match what print media lays out.
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready);
    await page.emulateMediaType('print');
    return await fn(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** How full the page is, measured in Chrome with print media — what the publish gate uses. */
export async function measureMenuFill(html: string): Promise<MenuFillReport> {
  return withPage(html, async (page) => (await page.evaluate(MENU_FILL_PROBE_SCRIPT)) as MenuFillReport);
}

/** The PDF plus the fill measurement and the page count of the result. */
export async function renderMenuPdf(html: string, page: { widthMm: number; heightMm: number }): Promise<MenuRenderResult> {
  const started = Date.now();
  return withPage(html, async (tab) => {
    const fill = (await tab.evaluate(MENU_FILL_PROBE_SCRIPT)) as MenuFillReport;
    const bytes = await tab.pdf({
      width: `${page.widthMm}mm`,
      height: `${page.heightMm}mm`,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      displayHeaderFooter: false
    });
    const pdf = Buffer.from(bytes);
    const document = await PDFDocument.load(pdf, { updateMetadata: false });
    return { pdf, fill, pageCount: document.getPageCount(), renderMs: Date.now() - started };
  });
}
